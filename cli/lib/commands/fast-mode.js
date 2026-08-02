import chalk from 'chalk';
import { loadConfig, saveConfig, configExists } from '../config.js';
import inquirer from 'inquirer';

/**
 * Fast-mode command - Configure fast LLM (Cerebras/Groq) for instant responses
 * @param {object} options - Command options
 * @param {boolean} options.disable - Remove fast LLM config
 * @returns {Promise<void>}
 */
export async function fastModeCommand(options = {}) {
  console.log(chalk.bold.cyan('\n⚡ Fast Mode Configuration\n'));
  console.log(chalk.gray('Routes simple questions to a fast LLM (Cerebras/Groq) for instant\nresponses. Complex queries still use Claude Code with tools.\n'));

  if (!configExists()) {
    console.log(chalk.red('✗ Configuration not found'));
    console.log(chalk.gray('  Run "claude-phone setup" first\n'));
    process.exit(1);
  }

  const config = await loadConfig();

  if (options.disable) {
    if (config.fastLlm) {
      delete config.fastLlm;
      await saveConfig(config);
      console.log(chalk.green('✓ Fast mode disabled\n'));
      console.log(chalk.gray('Restart services: claude-phone stop && claude-phone start\n'));
    } else {
      console.log(chalk.gray('Fast mode was not configured.\n'));
    }
    return;
  }

  // Show current config if exists
  if (config.fastLlm?.apiKey) {
    console.log(chalk.gray('Current fast LLM configuration:'));
    console.log(chalk.gray(`  Primary: ${config.fastLlm.provider} (${config.fastLlm.model})`));
    if (config.fastLlm.fallbackApiKey) {
      console.log(chalk.gray(`  Fallback: ${config.fastLlm.fallbackProvider} (${config.fastLlm.fallbackModel})`));
    }
    console.log('');

    const { reconfigure } = await inquirer.prompt([{
      type: 'confirm',
      name: 'reconfigure',
      message: 'Reconfigure fast mode?',
      default: false
    }]);

    if (!reconfigure) {
      console.log(chalk.gray('\nNo changes made.\n'));
      return;
    }
  }

  console.log(chalk.cyan('Get API keys:'));
  console.log(chalk.gray('  Groq (free, ~500 tok/s): https://console.groq.com\n'));

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Primary fast LLM provider:',
      choices: [
        { name: 'Groq (recommended — free, ~500 tok/s)', value: 'groq' },
        { name: 'ElectronHub gateway', value: 'electronhub' },
        { name: 'OpenAI-compatible (custom)', value: 'custom' },
      ],
      default: config.fastLlm?.provider || 'groq'
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Primary API key:',
      mask: '*',
      validate: (i) => i.trim() ? true : 'API key is required',
      when: (a) => a.provider !== 'custom'
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Primary base URL:',
      default: (a) => a.provider === 'groq' ? 'https://api.groq.com/openai/v1'
        : a.provider === 'electronhub' ? 'https://api.electronhub.ai/v1'
        : '',
      when: (a) => a.provider === 'custom'
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'Primary API key:',
      validate: (i) => i.trim() ? true : 'API key is required',
      when: (a) => a.provider === 'custom'
    },
    {
      type: 'input',
      name: 'model',
      message: 'Primary model:',
      default: (a) => {
        if (a.provider === 'groq') return 'openai/gpt-oss-120b';
        if (a.provider === 'electronhub') return 'llama-3.3-70b-versatile';
        return '';
      }
    },
    {
      type: 'confirm',
      name: 'setupFallback',
      message: 'Configure a fallback provider? (recommended)',
      default: true
    },
    {
      type: 'list',
      name: 'fallbackProvider',
      message: 'Fallback provider (used if primary fails):',
      choices: [
        { name: 'ElectronHub gateway', value: 'electronhub' },
        { name: 'Groq', value: 'groq' },
        { name: 'None / skip', value: 'none' },
      ],
      default: 'electronhub',
      when: (a) => a.setupFallback
    },
    {
      type: 'password',
      name: 'fallbackApiKey',
      message: 'Fallback API key:',
      mask: '*',
      when: (a) => a.setupFallback && a.fallbackProvider !== 'none' && a.fallbackProvider !== 'custom'
    },
    {
      type: 'input',
      name: 'fallbackModel',
      message: 'Fallback model:',
      default: (a) => a.fallbackProvider === 'groq' ? 'openai/gpt-oss-120b' : 'llama-3.3-70b-versatile',
      when: (a) => a.setupFallback && a.fallbackProvider !== 'none'
    }
  ]);

  // Build config
  const baseUrlMap = {
    groq: 'https://api.groq.com/openai/v1',
    electronhub: 'https://api.electronhub.ai/v1',
  };

  config.fastLlm = {
    provider: answers.provider,
    baseUrl: answers.baseUrl || baseUrlMap[answers.provider] || '',
    apiKey: answers.apiKey,
    model: answers.model,
  };

  if (answers.setupFallback && answers.fallbackProvider && answers.fallbackProvider !== 'none') {
    config.fastLlm.fallbackProvider = answers.fallbackProvider;
    config.fastLlm.fallbackBaseUrl = baseUrlMap[answers.fallbackProvider] || '';
    config.fastLlm.fallbackApiKey = answers.fallbackApiKey;
    config.fastLlm.fallbackModel = answers.fallbackModel;
    config.fastLlm.timeout = 5;
  }

  await saveConfig(config);

  console.log(chalk.bold.green('\n✓ Fast mode configured!\n'));
  console.log(chalk.gray('How it works:'));
  console.log(chalk.gray('  • Simple questions → ' + answers.provider + ' (instant, no hold music)'));
  console.log(chalk.gray('  • Complex tasks (docker, files, commands) → Claude Code (with tools)'));
  if (config.fastLlm.fallbackProvider) {
    console.log(chalk.gray('  • If ' + answers.provider + ' fails → ' + config.fastLlm.fallbackProvider + ' fallback'));
  }
  console.log(chalk.gray('\nRestart services:'));
  console.log(chalk.cyan('  claude-phone stop && claude-phone start\n'));
}
