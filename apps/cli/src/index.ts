import { createRequire } from 'node:module';

import { Command } from 'commander';

import { registerAgentCommand } from './commands/agent';
import { registerAgentGroupCommand } from './commands/agent-group';
import { registerBotCommand } from './commands/bot';
import { registerBriefCommand } from './commands/brief';
import { registerConfigCommand } from './commands/config';
import { registerConnectCommand } from './commands/connect';
import { registerCronCommand } from './commands/cron';
import { registerDeviceCommand } from './commands/device';
import { registerDocCommand } from './commands/doc';
import { registerEvalCommand } from './commands/eval';
import { registerFileCommand } from './commands/file';
import { registerGenerateCommand } from './commands/generate';
import { registerKbCommand } from './commands/kb';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerMemoryCommand } from './commands/memory';
import { registerMessageCommand } from './commands/message';
import { registerModelCommand } from './commands/model';
import { registerPluginCommand } from './commands/plugin';
import { registerProviderCommand } from './commands/provider';
import { registerSearchCommand } from './commands/search';
import { registerSessionGroupCommand } from './commands/session-group';
import { registerSkillCommand } from './commands/skill';
import { registerStatusCommand } from './commands/status';
import { registerTaskCommand } from './commands/task';
import { registerThreadCommand } from './commands/thread';
import { registerTopicCommand } from './commands/topic';
import { registerUserCommand } from './commands/user';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('lh')
  .description('LobeHub CLI - manage and connect to LobeHub services')
  .version(version);

registerLoginCommand(program);
registerLogoutCommand(program);
registerConnectCommand(program);
registerDeviceCommand(program);
registerStatusCommand(program);
registerDocCommand(program);
registerSearchCommand(program);
registerKbCommand(program);
registerMemoryCommand(program);
registerAgentCommand(program);
registerAgentGroupCommand(program);
registerBotCommand(program);
registerBriefCommand(program);
registerCronCommand(program);
registerGenerateCommand(program);
registerFileCommand(program);
registerSkillCommand(program);
registerSessionGroupCommand(program);
registerTaskCommand(program);
registerThreadCommand(program);
registerTopicCommand(program);
registerMessageCommand(program);
registerModelCommand(program);
registerProviderCommand(program);
registerPluginCommand(program);
registerUserCommand(program);
registerConfigCommand(program);
registerEvalCommand(program);

// Global error handler for clean TRPC error output
process.on('uncaughtException', (error: any) => {
  if (error?.name === 'TRPCClientError' || error?.constructor?.name?.includes('TRPCClientError')) {
    const message = error.message || 'Unknown error';
    const code = error.data?.code || error.shape?.data?.code || '';
    const path = error.data?.path || error.shape?.data?.path || '';
    console.error(`\x1B[31mError${path ? ` [${path}]` : ''}: ${message}\x1B[0m`);
    if (code) console.error(`\x1B[2mCode: ${code}\x1B[0m`);
    process.exit(1);
  }
  // Re-throw non-TRPC errors
  console.error(error?.message || error);
  process.exit(1);
});

process.on('unhandledRejection', (error: any) => {
  if (error?.name === 'TRPCClientError' || error?.constructor?.name?.includes('TRPCClientError')) {
    const message = error.message || 'Unknown error';
    const code = error.data?.code || error.shape?.data?.code || '';
    const path = error.data?.path || error.shape?.data?.path || '';
    console.error(`\x1B[31mError${path ? ` [${path}]` : ''}: ${message}\x1B[0m`);
    if (code) console.error(`\x1B[2mCode: ${code}\x1B[0m`);
    process.exit(1);
  }
  console.error(error?.message || error);
  process.exit(1);
});

program.parse();
