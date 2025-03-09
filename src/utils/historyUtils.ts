//src/utils/historyUtils.ts
import fs from 'fs/promises';
import { HistoryItem } from '../shared/types'; // Shared types
import { logToFile } from './logger';

function formatHistoryEntry(entry: HistoryItem): string {
    const role = entry.role === 'user' ? 'User' : 'Model';
    const partsText = entry.parts.map(part => part.text).join('\n');
    return `${role}:\n${partsText}\n`;
}

async function saveHistoryToFile(history: HistoryItem[], filePath: string): Promise<void> {
    try {
        const formattedHistory = history.map(formatHistoryEntry).join('\n---\n');
        await fs.writeFile(filePath, formattedHistory, 'utf-8');
        logToFile(`Chat history saved to file: ${filePath}`);
    } catch (error: any) {
        logToFile(`Error saving chat history: ${error.message}`);
    }
}

export { saveHistoryToFile };