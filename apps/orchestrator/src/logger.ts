import { pino, type LoggerOptions } from 'pino';
import { config } from './config.js';

const isProduction = process.env.NODE_ENV === 'production';

export const loggerOptions: LoggerOptions = {
  level: config.logLevel,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' },
      },
};

export const logger = pino(loggerOptions);
