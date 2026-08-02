import chalk from 'chalk';
import crypto from 'crypto';
import { loadConfig, saveConfig, configExists } from '../config.js';
import { getProjectRoot } from '../utils.js';
import inquirer from 'inquirer';

/**
 * Discord bot command - Configure Discord bot integration
 * @param {object} options - Command options
 * @param {boolean} options.disable - Remove Discord bot config
 * @returns {Promise<void>}
 */
export async function discordCommand(options = {}) {
  console.log(chalk.bold.cyan('\n🤖 Discord Bot Configuration\n'));

  if (!configExists()) {
    console.log(chalk.red('✗ Configuration not found'));
    console.log(chalk.gray('  Run "claude-phone setup" first\n'));
    process.exit(1);
  }

  const config = await loadConfig();

  if (options.disable) {
    if (config.discord) {
      delete config.discord.botToken;
      config.discord.enabled = false;
      await saveConfig(config);
      console.log(chalk.green('✓ Discord bot disabled\n'));
      console.log(chalk.gray('Restart services: claude-phone stop && claude-phone start\n'));
    } else {
      console.log(chalk.gray('Discord bot was not configured.\n'));
    }
    return;
  }

  // Show current config if exists
  if (config.discord?.botToken) {
    console.log(chalk.gray('Current Discord bot configuration:'));
    console.log(chalk.gray(`  Token: ${config.discord.botToken.substring(0, 20)}...`));
    console.log(chalk.gray(`  Channels: ${config.discord.allowedChannels || '(all)'}`));
    console.log(chalk.gray(`  Users: ${config.discord.allowedUsers || '(all)'}\n`));

    const { reconfigure } = await inquirer.prompt([{
      type: 'confirm',
      name: 'reconfigure',
      message: 'Reconfigure Discord bot?',
      default: false
    }]);

    if (!reconfigure) {
      console.log(chalk.gray('\nNo changes made.\n'));
      return;
    }
  }

  console.log(chalk.cyan('To create a Discord bot:'));
  console.log(chalk.gray('  1. Go to https://discord.com/developers/applications'));
  console.log(chalk.gray('  2. Create a new application'));
  console.log(chalk.gray('  3. Go to Bot section → Add Bot'));
  console.log(chalk.gray('  4. Copy the bot token'));
  console.log(chalk.gray('  5. Enable MESSAGE CONTENT INTENT in Bot settings'));
  console.log(chalk.gray('  6. Use this URL to invite (replace APP_ID):'));
  console.log(chalk.gray('     https://discord.com/api/oauth2/authorize?client_id=APP_ID&permissions=274877975552&scope=bot\n'));

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Discord bot token:',
      mask: '*',
      validate: (input) => {
        if (!input.trim()) return 'Bot token is required';
        if (input.trim().length < 50) return 'Token looks too short';
        return true;
      }
    },
    {
      type: 'input',
      name: 'allowedChannels',
      message: 'Allowed channel IDs (comma-separated, or blank for all):',
      default: config.discord?.allowedChannels || '',
      filter: (input) => input.trim()
    },
    {
      type: 'input',
      name: 'allowedUsers',
      message: 'Allowed user IDs (comma-separated, or blank for all):',
      default: config.discord?.allowedUsers || '',
      filter: (input) => input.trim()
    },
    {
      type: 'confirm',
      name: 'enableApiKey',
      message: 'Also generate an API key for remote access (port 3333)?',
      default: !config.discord?.apiKey,
      when: () => !config.discord?.apiKey
    }
  ]);

  // Build config
  if (!config.discord) config.discord = {};
  config.discord.botToken = answers.botToken.trim();
  config.discord.allowedChannels = answers.allowedChannels || '';
  config.discord.allowedUsers = answers.allowedUsers || '';
  config.discord.enabled = true;

  // Generate API key if requested
  if (answers.enableApiKey) {
    config.discord.apiKey = crypto.randomBytes(24).toString('hex');
    console.log(chalk.green('\n✓ API key generated for remote access'));
    console.log(chalk.bold.yellow(`  API_KEY: ${config.discord.apiKey}`));
    console.log(chalk.gray('  Use this in the Authorization header: Bearer <key>'));
    console.log(chalk.gray('  Or the x-api-key header\n'));
  }

  // Ensure paths include discord-bot
  if (!config.paths) config.paths = {};
  if (!config.paths.discordBot) {
    const projectRoot = getProjectRoot();
    config.paths.discordBot = `${projectRoot}/discord-bot`;
  }

  await saveConfig(config);

  console.log(chalk.bold.green('\n✓ Discord bot configured!\n'));
  console.log(chalk.gray('Restart services to apply:'));
  console.log(chalk.cyan('  claude-phone stop && claude-phone start\n'));

  if (config.discord.apiKey) {
    console.log(chalk.gray('Remote API access (from your PC):'));
    console.log(chalk.gray(`  curl -H "x-api-key: ${config.discord.apiKey}" \\`));
    console.log(chalk.gray(`    -H "Content-Type: application/json" \\`));
    console.log(chalk.gray(`    -d '{"prompt":"Hello"}' \\`));
    console.log(chalk.gray(`    http://YOUR_VM_IP:3333/chat\n`));
  }
}
