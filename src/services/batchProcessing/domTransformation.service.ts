import { Frame } from 'playwright';
import { singleton } from 'tsyringe';
import { Logger } from 'pino';

// Interface để định nghĩa các tham số cần thiết cho việc biến đổi
export interface IDomTransformationArgs {
    acronym: string;
    year: string;
    excludeTexts: string[];
    cfpTabKeywords: string[];
    importantDatesTabs: string[];
    exactKeywords: string[];
}

export interface IDomTransformationService {
    transformFrame(frame: Frame, args: IDomTransformationArgs, logger: Logger): Promise<void>;
}

@singleton()
export class DomTransformationService implements IDomTransformationService {
    public async transformFrame(frame: Frame, args: IDomTransformationArgs, logger: Logger): Promise<void> {
        const currentLogContext = { function: 'transformFrame', service: 'DomTransformationService', frameUrl: frame.url() };
        logger.trace({ ...currentLogContext, event: 'dom_preprocessing_start' });

        // Logic này được di chuyển nguyên vẹn từ PageContentExtractorService
        // Nó chạy trong context của trình duyệt
        await frame.evaluate((args) => {
            // --- BƯỚC 1: TIỀN XỬ LÝ DOM CƠ BẢN ---
            document.querySelectorAll('script, style').forEach(el => el.remove());

            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none') {
                    (el as HTMLElement).style.display = 'block';
                }
                if (style.visibility === 'hidden') {
                    (el as HTMLElement).style.visibility = 'visible';
                }
            });

            // --- BƯỚC 2: LOGIC BIẾN ĐỔI CỤ THỂ ---
            const { acronym, year, excludeTexts, cfpTabKeywords, importantDatesTabs, exactKeywords } = args;
            const isRelevant = (text: string | null, valueOrHref: string | null): boolean => {
                const lowerText = (text || "").toLowerCase().trim();
                const lowerValue = (valueOrHref || "").toLowerCase();
                if (excludeTexts.some(keyword => lowerText.includes(keyword))) return false;
                if (exactKeywords.includes(lowerText) || exactKeywords.includes(lowerValue)) return true;
                if (acronym && (lowerText.includes(acronym) || lowerValue.includes(acronym))) return true;
                if (year && (lowerText.includes(year) || lowerValue.includes(year))) return true;
                if (cfpTabKeywords.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;
                if (importantDatesTabs.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;
                return false;
            };

            // Xử lý thẻ <del>, <s>, <strike>
            document.querySelectorAll('del, s, strike').forEach(el => {
                const text = el.textContent;
                if (text && text.trim()) {
                    const trimmedText = text.trim();
                    const replacementSpan = document.createElement('span');
                    const containsNumber = /\d/.test(trimmedText);
                    if (containsNumber) {
                        replacementSpan.textContent = ` [Changed or passed: ${trimmedText}] `;
                    } else {
                        replacementSpan.textContent = ` ${trimmedText} `;
                    }
                    el.parentNode?.replaceChild(replacementSpan, el);
                }
            });

            // Xử lý thẻ <a>
            document.querySelectorAll('a').forEach(anchor => {
                let effectiveHref = anchor.getAttribute('href');
                const text = anchor.textContent;
                const hrefIsPlaceholder = !effectiveHref || effectiveHref.trim() === '#' || effectiveHref.trim().toLowerCase().startsWith('javascript:');

                if (hrefIsPlaceholder) {
                    const onclickAttr = anchor.getAttribute('onclick');
                    if (onclickAttr) {
                        const match = onclickAttr.match(/(?:location\.href|window\.location)\s*=\s*['"]([^'"]+)['"]/);
                        if (match && match[1]) {
                            effectiveHref = match[1];
                        }
                    }
                }

                if (isRelevant(text, effectiveHref)) {
                    const replacementSpan = document.createElement('span');
                    replacementSpan.textContent = ` href="${effectiveHref || ''}" - ${text?.trim()} `;
                    anchor.parentNode?.replaceChild(replacementSpan, anchor);
                }
            });

            // Xử lý thẻ <select>
            document.querySelectorAll('select').forEach(selectElement => {
                const optionsToExtract: HTMLElement[] = [];
                selectElement.querySelectorAll('option').forEach(option => {
                    const value = option.getAttribute('value');
                    const text = option.textContent;
                    if (isRelevant(text, value)) {
                        const replacementDiv = document.createElement('div');
                        replacementDiv.textContent = ` value="${value || ''}" - ${text?.trim()} `;
                        optionsToExtract.push(replacementDiv);
                    }
                });

                if (optionsToExtract.length > 0) {
                    for (let i = optionsToExtract.length - 1; i >= 0; i--) {
                        selectElement.parentNode?.insertBefore(optionsToExtract[i], selectElement.nextSibling);
                    }
                }
            });
        }, args);

        logger.trace({ ...currentLogContext, event: 'dom_preprocessing_complete' });
    }
}