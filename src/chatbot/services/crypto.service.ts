// src/services/crypto.service.ts
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto';
import { Buffer } from 'buffer';
import { injectable } from 'tsyringe';

@injectable()
export class CryptoService {
    private readonly SERVER_SECRET = process.env.ENCRYPTION_SERVER_SECRET;
    private readonly ALGORITHM = 'aes-256-gcm';
    private readonly IV_LENGTH = 16;
    private readonly AUTH_TAG_LENGTH = 16;

    // <<< BẮT ĐẦU THAY ĐỔI: THÊM BỘ ĐỆM KHÓA >>>
    // Sử dụng Map để lưu trữ các khóa đã được tạo ra.
    // Key: userId (string), Value: derivedKey (Buffer)
    private readonly keyCache = new Map<string, Buffer>();
    // <<< KẾT THÚC THAY ĐỔI >>>

    constructor() {
        if (!this.SERVER_SECRET) {
            throw new Error('CRITICAL: ENCRYPTION_SERVER_SECRET is not defined in environment variables.');
        }
    }

    /**
     * Tạo ra hoặc lấy từ cache một khóa mã hóa 256-bit (32 bytes) duy nhất cho mỗi user.
     * @param userId - ID của người dùng.
     * @returns Một Buffer chứa khóa mã hóa.
     */
    private deriveKey(userId: string): Buffer {
        // <<< BẮT ĐẦU THAY ĐỔI: LOGIC CACHING >>>
        // 1. Kiểm tra xem khóa đã có trong cache chưa
        if (this.keyCache.has(userId)) {
            // Nếu có, trả về ngay lập tức (cực kỳ nhanh)
            return this.keyCache.get(userId)!;
        }

        // 2. Nếu chưa có, thực hiện tính toán tốn kém
        const newKey = scryptSync(userId, this.SERVER_SECRET!, 32, { cost: 16384, blockSize: 8, parallelization: 1 });

        // 3. Lưu khóa vừa tạo vào cache cho những lần sử dụng sau
        this.keyCache.set(userId, newKey);

        // 4. Trả về khóa mới
        return newKey;
        // <<< KẾT THÚC THAY ĐỔI >>>
    }

    /**
     * Mã hóa một chuỗi văn bản.
     * (Không cần thay đổi hàm này)
     */
    public encrypt(text: string, userId: string): string {
        const key = this.deriveKey(userId); // Bây giờ hàm này rất nhanh sau lần gọi đầu tiên
        const iv = randomBytes(this.IV_LENGTH);
        const cipher = createCipheriv(this.ALGORITHM, key, iv);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }

    /**
     * Giải mã một chuỗi văn bản.
     * (Không cần thay đổi hàm này)
     */
    public decrypt(encryptedText: string, userId: string): string | null {
        try {
            const key = this.deriveKey(userId); // Bây giờ hàm này rất nhanh sau lần gọi đầu tiên
            const data = Buffer.from(encryptedText, 'base64');
            const iv = data.subarray(0, this.IV_LENGTH);
            const authTag = data.subarray(this.IV_LENGTH, this.IV_LENGTH + this.AUTH_TAG_LENGTH);
            const ciphertext = data.subarray(this.IV_LENGTH + this.AUTH_TAG_LENGTH);
            const decipher = createDecipheriv(this.ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return decrypted.toString('utf8');
        } catch (error) {
            return null;
        }
    }
}