import { Frame } from 'playwright';
import { singleton } from 'tsyringe';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

export interface IFrameTextExtractorService {
    extractTextFromFrame(frame: Frame, logger: Logger): Promise<string>;
}

@singleton()
export class FrameTextExtractorService implements IFrameTextExtractorService {
    public async extractTextFromFrame(frame: Frame, logger: Logger): Promise<string> {
        const currentLogContext = { function: 'extractTextFromFrame', service: 'FrameTextExtractorService', frameUrl: frame.url() };
        logger.trace({ ...currentLogContext, event: 'extracting_text_from_body' }, "Extracting text from the entire body.");

        try {
            // Luôn lấy text từ toàn bộ body của frame
            const frameText = await frame.locator('body').innerText({ timeout: 15000 });

            if (frameText && frameText.trim()) {
                logger.debug({ ...currentLogContext, textLength: frameText.length, event: 'frame_text_extracted_from_body' });
                return frameText.trim() + '\n\n';
            }
            return "";
        } catch (bodyError: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(bodyError);
            logger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'body_extraction_failed' }, `Could not extract text from frame's body: ${errorMessage}`);
            return "";
        }
    }
}