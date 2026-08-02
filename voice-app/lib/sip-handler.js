/**
 * SIP Call Handler with Conversation Loop
 * v12: Device registry integration with proper method names
 */

const { setTimeout: sleep } = require('node:timers/promises');

const ttsService = require('./tts-service');
const claudeBridge = require('./claude-bridge');
const fastLlm = require('./fast-llm');
const router = require('./router');

// Audio cue URLs
const READY_BEEP_URL = 'http://127.0.0.1:3000/static/ready-beep.wav';
const GOTIT_BEEP_URL = 'http://127.0.0.1:3000/static/gotit-beep.wav';
const HOLD_MUSIC_URL = 'http://127.0.0.1:3000/static/hold-music.wav';

// Default voice ID (Morpheus)
const DEFAULT_VOICE_ID = 'JAgnJveGGUh4qy4kh6dF';

// Claude Code-style thinking phrases
const THINKING_PHRASES = [
  "Pondering...",
  "Elucidating...",
  "Cogitating...",
  "Ruminating...",
  "Contemplating...",
  "Consulting the oracle...",
  "Summoning knowledge...",
  "Engaging neural pathways...",
  "Accessing the mainframe...",
  "Querying the void...",
  "Let me think about that...",
  "Processing...",
  "Hmm, interesting question...",
  "One moment...",
  "Searching my brain...",
];

function getRandomThinkingPhrase() {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

function extractCallerId(req) {
  var from = req.get("From") || "";
  var match = from.match(/sip:([+\d]+)@/);
  if (match) return match[1];
  var numMatch = from.match(/<sip:(\d+)@/);
  if (numMatch) return numMatch[1];
  return "unknown";
}

/**
 * Extract dialed extension from SIP To header
 */
function extractDialedExtension(req) {
  var to = req.get("To") || "";
  var match = to.match(/sip:(\d+)@/);
  if (match) {
    return match[1];
  }
  return null;
}

function isGoodbye(transcript) {
  const lower = transcript.toLowerCase().trim();
  const goodbyePhrases = ['goodbye', 'good bye', 'bye', 'hang up', 'end call', "that's all", 'thats all'];
  return goodbyePhrases.some(function(phrase) {
    return lower === phrase || lower.includes(' ' + phrase) ||
           lower.startsWith(phrase + ' ') || lower.endsWith(' ' + phrase);
  });
}

/**
 * Extract voice-friendly line from Claude's response
 * Priority: VOICE_RESPONSE > CUSTOM COMPLETED > COMPLETED > first sentence
 */
function extractVoiceLine(response) {
  // Priority 1: VOICE_RESPONSE (new format)
  var voiceMatch = response.match(/🗣️\s*VOICE_RESPONSE:\s*([^\n]+)/im);
  if (voiceMatch) {
    var text = voiceMatch[1].trim().replace(/\*+/g, '').replace(/\[.*?\]/g, '').trim();
    if (text && text.split(/\s+/).length <= 60) {
      return text;
    }
  }

  // Priority 2: CUSTOM COMPLETED
  var customMatch = response.match(/🗣️\s*CUSTOM\s+COMPLETED:\s*(.+?)(?:\n|$)/im);
  if (customMatch) {
    text = customMatch[1].trim().replace(/\*+/g, '').replace(/\[.*?\]/g, '').trim();
    if (text && text.split(/\s+/).length <= 50) {
      return text;
    }
  }

  // Priority 3: COMPLETED
  var completedMatch = response.match(/🎯\s*COMPLETED:\s*(.+?)(?:\n|$)/im);
  if (completedMatch) {
    return completedMatch[1].trim().replace(/\*+/g, '').replace(/\[.*?\]/g, '').trim();
  }

  // Priority 4: First sentence
  var firstSentence = response.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length < 500) {
    return firstSentence.trim();
  }

  return response.substring(0, 500).trim();
}

/**
 * Main conversation loop
 * @param {Object} deviceConfig - Device configuration (name, prompt, voiceId, etc.) or null for default
 */
async function conversationLoop(endpoint, dialog, callUuid, options, deviceConfig) {
  const { ttsService, whisperClient, claudeBridge, wsPort, audioForkServer } = options;

  let session = null;
  let forkRunning = false;
  let callActive = true;
  let musicPlaying = false;

  // Get device-specific settings
  const deviceName = deviceConfig ? deviceConfig.name : 'Morpheus';
  const devicePrompt = deviceConfig ? deviceConfig.prompt : null;
  const voiceId = (deviceConfig && deviceConfig.voiceId) ? deviceConfig.voiceId : DEFAULT_VOICE_ID;
  const greeting = deviceConfig && deviceConfig.name !== 'Morpheus'
    ? "Hello! I'm " + deviceConfig.name + ". How can I help you today?"
    : "Hello! I'm your server. How can I help you today?";

  // Track call end so we stop all operations on the dead endpoint
  const onDialogDestroy = function() {
    callActive = false;
    musicPlaying = false;
    console.log('[' + new Date().toISOString() + '] CALL Ended (dialog destroyed)');
    if (endpoint) endpoint.destroy().catch(function() {});
  };
  dialog.on('destroy', onDialogDestroy);

  try {
    console.log('[' + new Date().toISOString() + '] CONVERSATION Starting (session: ' + callUuid + ', device: ' + deviceName + ', voice: ' + voiceId + ')...');

    // Play device-specific greeting with device voice
    if (callActive) {
      const greetingUrl = await ttsService.generateSpeech(greeting, voiceId);
      if (callActive) await endpoint.play(greetingUrl);
    }

    if (!callActive) {
      console.log('[' + new Date().toISOString() + '] CONVERSATION Call ended before audio started');
      return;
    }

    // Start fork for entire call
    const wsUrl = 'ws://127.0.0.1:' + wsPort + '/' + encodeURIComponent(callUuid);
    const sessionPromise = audioForkServer.expectSession(callUuid, { timeoutMs: 10000 });

    await endpoint.forkAudioStart({
      wsUrl: wsUrl,
      mixType: 'mono',
      sampling: '16k'
    });
    forkRunning = true;

    session = await sessionPromise;
    console.log('[' + new Date().toISOString() + '] AUDIO Fork connected');

    // Main conversation loop
    let turnCount = 0;
    const MAX_TURNS = 20;

    while (turnCount < MAX_TURNS && callActive) {
      turnCount++;
      console.log('[' + new Date().toISOString() + '] CONVERSATION Turn ' + turnCount + '/' + MAX_TURNS);

      // READY BEEP
      if (callActive) {
        try {
          await endpoint.play(READY_BEEP_URL);
        } catch (e) {
          console.log('[' + new Date().toISOString() + '] BEEP: Ready beep failed, continuing');
        }
      }

      if (!callActive) break;

      session.setCaptureEnabled(true);
      console.log('[' + new Date().toISOString() + '] LISTEN Waiting for speech...');

      let utterance = null;
      try {
        utterance = await session.waitForUtterance({ timeoutMs: 30000 });
        console.log('[' + new Date().toISOString() + '] LISTEN Got: ' + utterance.audio.length + ' bytes');
      } catch (err) {
        console.log('[' + new Date().toISOString() + '] LISTEN Timeout: ' + err.message);
      }

      if (!callActive) break;

      session.setCaptureEnabled(false);

      if (!utterance) {
        if (callActive) {
          const promptUrl = await ttsService.generateSpeech("I didn't hear anything. Are you still there?", voiceId);
          if (callActive) await endpoint.play(promptUrl);
        }
        continue;
      }

      // GOT-IT BEEP
      if (callActive) {
        try {
          await endpoint.play(GOTIT_BEEP_URL);
        } catch (e) {
          console.log('[' + new Date().toISOString() + '] BEEP: Got-it beep failed, continuing');
        }
      }

      // Transcribe
      const transcript = await whisperClient.transcribe(utterance.audio, {
        format: 'pcm',
        sampleRate: 16000
      });

      console.log('[' + new Date().toISOString() + '] WHISPER: "' + transcript + '"');

      if (!callActive) break;

      if (!transcript || transcript.trim().length < 2) {
        if (callActive) {
          const clarifyUrl = await ttsService.generateSpeech("Sorry, I didn't catch that. Could you repeat?", voiceId);
          if (callActive) await endpoint.play(clarifyUrl);
        }
        continue;
      }

      if (isGoodbye(transcript)) {
        if (callActive) {
          const byeUrl = await ttsService.generateSpeech("Goodbye! Call again anytime.", voiceId);
          if (callActive) await endpoint.play(byeUrl);
        }
        break;
      }

      // THINKING FEEDBACK
      const thinkingPhrase = getRandomThinkingPhrase();
      console.log('[' + new Date().toISOString() + '] THINKING: "' + thinkingPhrase + '"');
      if (callActive) {
        const thinkingUrl = await ttsService.generateSpeech(thinkingPhrase, voiceId);
        if (callActive) await endpoint.play(thinkingUrl);
      }

      if (!callActive) break;

      // Route query: fast path (Cerebras/Groq) vs slow path (Claude Code)
      const route = router.classify(transcript);
      const fastAvailable = fastLlm.isAvailable();
      let voiceLine;

      if (route.path === 'fast' && fastAvailable) {
        // ===== FAST PATH (no hold music — should be ~1-2s) =====
        console.log('[' + new Date().toISOString() + '] FAST_LLM Routing (' + route.reason + '): "' + transcript.substring(0, 60) + '"');
        try {
          const fastSystem = devicePrompt
            ? devicePrompt + '\n\nKeep your answer conversational and under 40 words. This will be spoken aloud. No URLs, no code blocks.'
            : 'You are a helpful voice assistant. Be concise, under 40 words. No URLs or code.';
          const result = await fastLlm.query(transcript, { systemPrompt: fastSystem });
          voiceLine = result.response;
          console.log('[' + new Date().toISOString() + '] FAST_LLM Response (' + result.provider + '): "' + voiceLine.substring(0, 80) + '"');
        } catch (fastErr) {
          // Fast path failed — fall through to slow path
          console.warn('[' + new Date().toISOString() + '] FAST_LLM Failed (' + fastErr.message + '), falling back to Claude');
          voiceLine = null;
        }
      } else if (route.path === 'fast' && !fastAvailable) {
        console.log('[' + new Date().toISOString() + '] ROUTER fast but FAST_LLM not configured, using Claude');
        voiceLine = null;
      }

      if (!voiceLine) {
        // ===== SLOW PATH (Claude Code with tools) =====
        // Hold music in background (loops until stopped)
        musicPlaying = true;
        const musicLoop = async () => {
          while (musicPlaying && callActive) {
            try {
              await endpoint.play(HOLD_MUSIC_URL);
            } catch (e) {
              console.log('[' + new Date().toISOString() + '] MUSIC: Hold music stopped');
              break;
            }
          }
        };
        musicLoop();

        console.log('[' + new Date().toISOString() + '] CLAUDE Querying (device: ' + deviceName + ')...');
        const claudeResponse = await claudeBridge.query(
          transcript,
          { callId: callUuid, devicePrompt: devicePrompt }
        );

        // Stop hold music
        musicPlaying = false;
        if (callActive) {
          try {
            await endpoint.api('uuid_break', endpoint.uuid);
          } catch (e) {}
        }

        // Check if call ended during Claude processing
        if (!callActive) {
          console.log('[' + new Date().toISOString() + '] CLAUDE Response received but call ended');
          break;
        }

        console.log('[' + new Date().toISOString() + '] CLAUDE Response received');
        voiceLine = extractVoiceLine(claudeResponse);
      }

      console.log('[' + new Date().toISOString() + '] VOICE: "' + voiceLine + '"');

      const responseUrl = await ttsService.generateSpeech(voiceLine, voiceId);
      if (callActive) await endpoint.play(responseUrl);

      console.log('[' + new Date().toISOString() + '] CONVERSATION Turn ' + turnCount + ' complete');
    }

    if (turnCount >= MAX_TURNS && callActive) {
      const maxUrl = await ttsService.generateSpeech("We've been talking for a while. Goodbye!", voiceId);
      if (callActive) await endpoint.play(maxUrl);
    }

  } catch (error) {
    console.error('[' + new Date().toISOString() + '] CONVERSATION Error:', error.message);
    try {
      if (session) session.setCaptureEnabled(false);
      if (callActive) {
        const errUrl = await ttsService.generateSpeech("Sorry, something went wrong.", voiceId);
        if (callActive) await endpoint.play(errUrl);
      }
    } catch (e) {}
  } finally {
    musicPlaying = false;
    console.log('[' + new Date().toISOString() + '] CONVERSATION Cleanup...');

    // Remove our destroy listener
    dialog.off('destroy', onDialogDestroy);

    try {
      await claudeBridge.endSession(callUuid);
    } catch (e) {}

    if (forkRunning) {
      try {
        await endpoint.forkAudioStop();
      } catch (e) {}
    }

    // Only destroy the dialog if the caller hasn't already hung up
    // (calling destroy on an already-destroyed dialog throws "unable to find dialog")
    if (callActive) {
      try { dialog.destroy(); } catch (e) {}
    }
  }
}

/**
 * Strip video tracks from SDP (FreeSWITCH doesn't support H.261 and rejects with 488)
 * Keeps only audio tracks to ensure codec negotiation succeeds
 */
function stripVideoFromSdp(sdp) {
  if (!sdp) return sdp;

  const lines = sdp.split('\r\n');
  const result = [];
  let inVideoSection = false;

  for (const line of lines) {
    // Check if we're entering a video media section
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      continue; // Skip the m=video line
    }

    // Check if we're entering a new media section (audio, etc.)
    if (line.startsWith('m=') && !line.startsWith('m=video')) {
      inVideoSection = false;
    }

    // Skip all lines in the video section
    if (inVideoSection) {
      continue;
    }

    result.push(line);
  }

  return result.join('\r\n');
}

/**
 * Handle incoming SIP INVITE
 */
async function handleInvite(req, res, options) {
  const { mediaServer, deviceRegistry } = options;

  const callerId = extractCallerId(req);
  const dialedExt = extractDialedExtension(req);

  // Look up device config using deviceRegistry.get() (works with name OR extension)
  let deviceConfig = null;
  if (deviceRegistry && dialedExt) {
    deviceConfig = deviceRegistry.get(dialedExt);
    if (deviceConfig) {
      console.log('[' + new Date().toISOString() + '] CALL Device matched: ' + deviceConfig.name + ' (ext ' + dialedExt + ')');
    } else {
      console.log('[' + new Date().toISOString() + '] CALL Unknown extension ' + dialedExt + ', using default');
      deviceConfig = deviceRegistry.getDefault();
    }
  }

  console.log('[' + new Date().toISOString() + '] CALL Incoming from: ' + callerId + ' to ext: ' + (dialedExt || 'unknown'));

  try {
    // Strip video from SDP to avoid FreeSWITCH 488 error with unsupported video codecs
    const originalSdp = req.body;
    const audioOnlySdp = stripVideoFromSdp(originalSdp);
    if (originalSdp !== audioOnlySdp) {
      console.log('[' + new Date().toISOString() + '] CALL Stripped video track from SDP');
    }

    const result = await mediaServer.connectCaller(req, res, { remoteSdp: audioOnlySdp });
    const { endpoint, dialog } = result;
    const callUuid = endpoint.uuid;

    console.log('[' + new Date().toISOString() + '] CALL Connected: ' + callUuid);

    // conversationLoop registers its own dialog 'destroy' handler for cleanup

    await conversationLoop(endpoint, dialog, callUuid, options, deviceConfig);
    return { endpoint: endpoint, dialog: dialog, callerId: callerId, callUuid: callUuid };

  } catch (error) {
    console.error('[' + new Date().toISOString() + '] CALL Error:', error.message);
    try { res.send(500); } catch (e) {}
    throw error;
  }
}

module.exports = {
  handleInvite: handleInvite,
  extractCallerId: extractCallerId,
  extractDialedExtension: extractDialedExtension
};
