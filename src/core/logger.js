const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

/**
 * Logger utility for KLVR Support Tool
 * Provides consistent logging with optional file output and session tracking
 */
class Logger {
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.logFile = options.logFile || null;
        this.sessionId = options.sessionId || null;
        this.logLevel = process.env.KLVR_LOG_LEVEL || 'info';
        this.logDir = process.env.KLVR_LOG_DIR || './logs';
        
        // Create log directory if logging to file
        if (this.logFile) {
            this._ensureLogDirectory();
        }
    }

    /**
     * Log an info message
     */
    info(message, ...args) {
        this._log('info', '📋', 'blue', message, ...args);
    }

    /**
     * Log a success message
     */
    success(message, ...args) {
        this._log('info', '✅', 'green', message, ...args);
    }

    /**
     * Log a warning message
     */
    warn(message, ...args) {
        this._log('warn', '⚠️ ', 'yellow', message, ...args);
    }

    /**
     * Log an error message
     */
    error(message, ...args) {
        this._log('error', '❌', 'red', message, ...args);
    }

    /**
     * Log a debug message (only if verbose mode is enabled)
     */
    debug(message, ...args) {
        if (this.verbose || this.logLevel === 'debug') {
            this._log('debug', '🔍', 'gray', message, ...args);
        }
    }

    /**
     * Log a step in a process
     */
    step(message, ...args) {
        this._log('info', '🔄', 'cyan', message, ...args);
    }

    /**
     * Create a spinner for long-running operations
     */
    spinner(text) {
        // Note: ora is already a dependency, we can use it
        const ora = require('ora');
        return ora({ text, color: 'blue' });
    }

    /**
     * Start a session with optional session ID
     */
    startSession(sessionId = null) {
        this.sessionId = sessionId || `session-${Date.now()}`;
        this.info(`Starting session: ${this.sessionId}`);
        return this.sessionId;
    }

    /**
     * End the current session
     */
    endSession() {
        if (this.sessionId) {
            this.info(`Ending session: ${this.sessionId}`);
            this.sessionId = null;
        }
    }

    /**
     * Internal logging method
     */
    _log(level, emoji, color, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedMessage = this._formatMessage(message, ...args);
        
        // Console output with colors
        const coloredMessage = chalk[color](`${emoji} ${formattedMessage}`);
        console.log(coloredMessage);

        // File output (without colors)
        if (this.logFile) {
            const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${this.sessionId ? `[${this.sessionId}] ` : ''}${formattedMessage}\n`;
            this._writeToFile(logEntry);
        }
    }

    /**
     * Format message with arguments
     */
    _formatMessage(message, ...args) {
        if (args.length === 0) {
            return message;
        }
        
        // Simple string interpolation
        let formatted = message;
        args.forEach((arg, index) => {
            const placeholder = `{${index}}`;
            if (formatted.includes(placeholder)) {
                formatted = formatted.replace(placeholder, String(arg));
            } else {
                // If no placeholder, append arguments
                formatted += ` ${String(arg)}`;
            }
        });
        
        return formatted;
    }

    /**
     * Ensure log directory exists
     */
    async _ensureLogDirectory() {
        try {
            const logDir = path.dirname(this.logFile);
            await fs.mkdir(logDir, { recursive: true });
        } catch (error) {
            console.warn(chalk.yellow(`⚠️  Could not create log directory: ${error.message}`));
        }
    }

    /**
     * Write to log file
     */
    async _writeToFile(entry) {
        try {
            await fs.appendFile(this.logFile, entry);
        } catch (error) {
            console.warn(chalk.yellow(`⚠️  Could not write to log file: ${error.message}`));
        }
    }
}

module.exports = Logger;
