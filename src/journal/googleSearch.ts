// src/googleSearch.ts

import axios from 'axios';
import { retryAsync } from './utils';
import { RETRY_OPTIONS } from '../config';

interface GoogleSearchResult {
    imageLink: string | null;
    contextLink: string | null;
}

export const fetchGoogleImage = async (title: string | null, formattedISSN: string, apiKey: string | null, cseId: string | null): Promise<GoogleSearchResult> => {
    if (!apiKey || !cseId) {
        // logger.error(`Missing API Key or CSE ID for image search (ISSN: ${formattedISSN})`);
        return { imageLink: null, contextLink: null };
    }

    const encodedISSN = encodeURIComponent(`${title} ISSN "${formattedISSN}"`);
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodedISSN}&key=${apiKey}&cx=${cseId}&searchType=image&num=1`;
    console.log(url)
    try {
        const response = await retryAsync(async () => {
            const res = await axios.get(url);

            if (res.data && res.data.error) {
                const googleError = res.data.error;
                const reason = googleError.errors?.[0]?.reason || 'unknown';
                // logger.error(`Google Image Search API Error (Key: ${apiKey.substring(0, 5)}... ISSN: ${formattedISSN}): ${googleError.message} (Reason: ${reason})`);
                throw new Error(`Google API Error: ${googleError.message} (Reason: ${reason})`);
            }
            if (res.status < 200 || res.status >= 300) {
                // logger.error(`Google Image Search API returned non-2xx status: ${res.status} (Key: ${apiKey.substring(0, 5)}... ISSN: ${formattedISSN})`);
                throw new Error(`Google API returned non-2xx status: ${res.status}`);
            }
            return res;
        }, RETRY_OPTIONS);

        const data: any = response.data; // Keep it as 'any' because the structure is complex

        if (data.items && data.items.length > 0) {
            const firstItem: any = data.items[0]; // Keep it as 'any'
            const imageLink: string | undefined = firstItem.link;
            const contextLink: string | undefined = firstItem.image?.contextLink;
            return { imageLink: imageLink || null, contextLink: contextLink || null };
        } else {
            return { imageLink: null, contextLink: null };
        }
    } catch (error: any) {
        // logger.error(`Failed to fetch image for ISSN ${formattedISSN} after retries (Key: ${apiKey.substring(0, 5)}...): ${error.message}`);
        return { imageLink: null, contextLink: null };
    }
};