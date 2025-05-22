// src/utils/historyUtils.ts
import fs from 'fs/promises';
import { ChatHistoryItem } from '../shared/types'; // Import shared types
import logToFile from '../../utils/logger';

/**
 * Formats a single chat history entry into a human-readable string.
 * It extracts the role (User/Model) and concatenates text parts.
 *
 * @param {ChatHistoryItem} entry - The chat history item to format.
 * @returns {string} A formatted string representation of the history entry.
 */
function formatHistoryEntry(entry: ChatHistoryItem): string {
    const role = entry.role === 'user' ? 'User' : 'Model';
    // Concatenate all text parts into a single string, separated by newlines.
    const partsText = entry.parts.map(part => 'text' in part ? part.text : '').filter(Boolean).join('\n');
    return `${role}:\n${partsText}\n`;
}

/**
 * Saves the given chat history to a specified file path.
 * Each entry is formatted using `formatHistoryEntry` and separated by a delimiter.
 * Handles file writing errors gracefully by logging them.
 *
 * @param {ChatHistoryItem[]} history - An array of chat history items to save.
 * @param {string} filePath - The full path to the file where the history will be saved.
 * @returns {Promise<void>} A Promise that resolves when the history is saved, or rejects if an error occurs.
 */
async function saveHistoryToFile(history: ChatHistoryItem[], filePath: string): Promise<void> {
    try {
        // Map each history item to its formatted string, then join them with a separator.
        const formattedHistory = history.map(formatHistoryEntry).join('\n---\n');
        await fs.writeFile(filePath, formattedHistory, 'utf-8');
        logToFile(`[HistoryUtils] Chat history successfully saved to file: ${filePath}`);
    } catch (error: unknown) { // Catch as unknown for safer error handling
        const errorMessage = error instanceof Error ? error.message : String(error);
        logToFile(`[HistoryUtils] Error saving chat history to ${filePath}: ${errorMessage}`);
        // Optionally re-throw or handle more specifically if critical
    }
}

export { saveHistoryToFile };