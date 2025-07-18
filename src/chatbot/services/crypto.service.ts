// src/services/crypto.service.ts
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto';
import { Buffer } from 'buffer';
import { injectable } from 'tsyringe';

@injectable()
export class CryptoService {
    // Lấy chuỗi bí mật từ biến môi trường.
    private readonly SERVER_SECRET = process.env.ENCRYPTION_SERVER_SECRET;
    private readonly ALGORITHM = 'aes-256-gcm'; // Thuật toán mã hóa hiện đại và an toàn.
    private readonly IV_LENGTH = 16; // Độ dài Initialization Vector.
    private readonly AUTH_TAG_LENGTH = 16; // Độ dài Authentication Tag.

    constructor() {
        if (!this.SERVER_SECRET) {
            throw new Error('CRITICAL: ENCRYPTION_SERVER_SECRET is not defined in environment variables.');
        }
    }

    /**
     * Tạo ra một khóa mã hóa 256-bit (32 bytes) duy nhất và ổn định cho mỗi user.
     * @param userId - ID của người dùng.
     * @returns Một Buffer chứa khóa mã hóa.
     */
    private deriveKey(userId: string): Buffer {
        // Sử dụng scrypt để tạo khóa từ user ID và server secret.
        // Scrypt là một hàm dẫn xuất khóa (KDF) mạnh, chống lại tấn công brute-force.
        return scryptSync(userId, this.SERVER_SECRET!, 32, { cost: 16384, blockSize: 8, parallelization: 1 });
    }

    /**
     * Mã hóa một chuỗi văn bản.
     * @param text - Dữ liệu cần mã hóa.
     * @param userId - ID của người dùng để tạo khóa mã hóa.
     * @returns Một chuỗi base64 chứa (IV + AuthTag + Ciphertext).
     */
    public encrypt(text: string, userId: string): string {
        const key = this.deriveKey(userId);
        const iv = randomBytes(this.IV_LENGTH);
        const cipher = createCipheriv(this.ALGORITHM, key, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Ghép IV, AuthTag và dữ liệu đã mã hóa lại với nhau để lưu trữ.
        return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }

    /**
     * Giải mã một chuỗi văn bản.
     * @param encryptedText - Chuỗi base64 đã được mã hóa.
     * @param userId - ID của người dùng để tạo khóa giải mã.
     * @returns Chuỗi văn bản gốc, hoặc null nếu giải mã thất bại.
     */
    public decrypt(encryptedText: string, userId: string): string | null {
        try {
            const key = this.deriveKey(userId);
            const data = Buffer.from(encryptedText, 'base64');

            // <<< BẮT ĐẦU THAY ĐỔI >>>
            // Sử dụng `subarray` thay cho `slice` để tránh cảnh báo deprecated.
            // Chức năng hoàn toàn tương tự trong trường hợp này.
            const iv = data.subarray(0, this.IV_LENGTH);
            const authTag = data.subarray(this.IV_LENGTH, this.IV_LENGTH + this.AUTH_TAG_LENGTH);
            const ciphertext = data.subarray(this.IV_LENGTH + this.AUTH_TAG_LENGTH);
            // <<< KẾT THÚC THAY ĐỔI >>>

            const decipher = createDecipheriv(this.ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return decrypted.toString('utf8');
        } catch (error) {
            // Lỗi có thể xảy ra nếu khóa sai, dữ liệu bị thay đổi, hoặc định dạng không đúng.
            console.error(`[CryptoService] Decryption failed for user ${userId}. It might be due to a key change or data corruption.`);
            return null;
        }
    }
}