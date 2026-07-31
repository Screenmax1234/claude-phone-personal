import axios from 'axios';

/**
 * Validate ElevenLabs API key by making a test request
 * @param {string} apiKey - ElevenLabs API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateElevenLabsKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unexpected status: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (401 Unauthorized)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate Groq API key by making a test request
 * @param {string} apiKey - Groq API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateGroqKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    const response = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unexpected status: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (401 Unauthorized)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate Airforce API key by making a test request
 * @param {string} apiKey - Airforce API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateAirforceKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    // /v1/audio/voices is auth-gated (returns 401 for invalid keys), unlike
    // /v1/models which is a public catalog.
    const response = await axios.get('https://api.airforce/v1/audio/voices', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unexpected status: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (401 Unauthorized)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate ElectronHub API key by making a test request
 * @param {string} apiKey - ElectronHub API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateElectronHubKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    // /models is public on ElectronHub, so we POST a minimal /audio/speech
    // request with empty input. A valid key gets 400 (bad request), an invalid
    // key gets 401. Any non-401 response confirms the key is authenticated.
    const response = await axios.post('https://api.electronhub.ai/v1/audio/speech', {
      model: 'gpt-4o-mini-tts',
      input: '',
      voice: 'coral'
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (response.status === 401) {
      return {
        valid: false,
        error: 'Invalid API key (401 Unauthorized)'
      };
    }

    return { valid: true };
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate SIP extension format
 * @param {string} extension - SIP extension number
 * @returns {boolean} True if valid
 */
export function validateExtension(extension) {
  return /^\d{4,5}$/.test(extension);
}

/**
 * Validate IP address format
 * @param {string} ip - IP address
 * @returns {boolean} True if valid
 */
export function validateIP(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return false;
  }

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Validate hostname format
 * @param {string} hostname - Hostname or FQDN
 * @returns {boolean} True if valid
 */
export function validateHostname(hostname) {
  const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return hostnameRegex.test(hostname);
}

/**
 * Validate ElevenLabs voice ID
 * @param {string} apiKey - ElevenLabs API key
 * @param {string} voiceId - Voice ID to validate
 * @returns {Promise<{valid: boolean, name?: string, error?: string}>} Validation result
 */
export async function validateVoiceId(apiKey, voiceId) {
  if (!voiceId || voiceId.trim() === '') {
    return {
      valid: false,
      error: 'Voice ID cannot be empty'
    };
  }

  try {
    const response = await axios.get(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: {
        'xi-api-key': apiKey
      },
      timeout: 10000
    });

    if (response.status === 200 && response.data.name) {
      return {
        valid: true,
        name: response.data.name
      };
    }

    return {
      valid: false,
      error: `Unexpected response: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return {
          valid: false,
          error: 'Voice ID not found'
        };
      }
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (cannot validate voice ID)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}
