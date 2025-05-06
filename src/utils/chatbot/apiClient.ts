// src/utils/apiClient.ts
import { container } from 'tsyringe';
import axios, { AxiosError } from 'axios';
import logToFile from '../logger';

import { ConfigService } from '../../config/config.service';

const configService = container.resolve(ConfigService);

// --- Lấy cấu hình từ ConfigService ---
// Đảm bảo DATABASE_URL tồn tại trong config
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}


// Định nghĩa kiểu dữ liệu trả về từ API /me
export interface UserInfo {
    id: string;
    email: string;
    role: string;
}

/**
 * Gọi API /me để lấy thông tin người dùng từ token.
 * @param token - JWT token của người dùng.
 * @returns Promise chứa thông tin UserInfo hoặc null nếu lỗi.
 */
export const fetchUserInfo = async (token: string): Promise<UserInfo | null> => {
    const url = `${DATABASE_URL}/user/me`; // Lấy URL từ config
    logToFile(`[API Client] Fetching user info from: ${url}`);

    if (!token) {
        logToFile('[API Client] fetchUserInfo called with no token.');
        return null;
    }

    try {
        const response = await axios.get<UserInfo>(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json', // Đảm bảo nhận JSON
            },
            timeout: 5000 // Đặt timeout (ví dụ: 5 giây)
        });

        if (response.status === 200 && response.data && response.data.id) {
            logToFile(`[API Client] Successfully fetched user info for ID: ${response.data.id}`);
            return response.data; // Trả về { id, email, role }
        } else {
            logToFile(`[API Client] Unexpected response status or data format from /me. Status: ${response.status}`);
            return null;
        }

    } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
            // Lỗi từ phía server API (4xx, 5xx)
            logToFile(`[API Client] Error fetching user info. Status: ${axiosError.response.status}, Data: ${JSON.stringify(axiosError.response.data)}`);
        } else if (axiosError.request) {
            // Request đã gửi nhưng không nhận được response (network error, timeout)
            logToFile(`[API Client] Error fetching user info: No response received. ${axiosError.message}`);
        } else {
            // Lỗi khác khi setup request
            logToFile(`[API Client] Error fetching user info: Request setup error. ${axiosError.message}`);
        }
        return null; // Trả về null khi có lỗi
    }
};