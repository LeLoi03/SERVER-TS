import { Frame } from 'playwright';
import { singleton } from 'tsyringe';

export interface IImageUrlExtractorService {
    extractImageUrlsFromFrame(frame: Frame, imageKeywords: string[]): Promise<string[]>;
}

@singleton()
export class ImageUrlExtractorService implements IImageUrlExtractorService {
    public async extractImageUrlsFromFrame(frame: Frame, imageKeywords:string[]): Promise<string[]> {
        // Logic này được di chuyển nguyên vẹn từ PageContentExtractorService
        return frame.evaluate((args) => {
            const foundUrls = new Set<string>();
            const { imageKeywords } = args;

            document.querySelectorAll('img').forEach(img => {
                if (foundUrls.size >= 2) return; // Giới hạn logic tìm kiếm để tối ưu

                const src = img.getAttribute('src');
                if (!src) return;

                const alt = img.getAttribute('alt') || '';
                const className = img.className || '';
                const id = img.id || '';

                // *** THAY ĐỔI Ở ĐÂY ***: Đã thêm className và id vào chuỗi để kiểm tra
                const combinedAttributes = `${src} ${alt} ${className} ${id}`.toLowerCase();
                const hasKeyword = imageKeywords.some(keyword => combinedAttributes.includes(keyword.toLowerCase()));

                if (hasKeyword) {
                    try {
                        const absoluteUrl = new URL(src, document.baseURI).href;
                        foundUrls.add(absoluteUrl);
                    } catch (e) {
                        // Bỏ qua nếu URL không hợp lệ
                    }
                }
            });
            return Array.from(foundUrls);
        }, { imageKeywords });
    }
}