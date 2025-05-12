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


// Định nghĩa kiểu dữ liệu trả về từ API /me và /auth/admin/me
export interface UserInfo {
    id: string;
    email: string;
    role: string;
}

/**
 * Gọi API để lấy thông tin người dùng từ token.
 * Trước tiên kiểm tra /user/me. Nếu không có user, kiểm tra /auth/admin/me.
 * Trả về thông tin người dùng (admin hoặc user) nếu tìm thấy, ngược lại trả về null.
 * @param token - JWT token của người dùng.
 * @returns Promise chứa thông tin UserInfo (có thể là admin hoặc user) hoặc null nếu không tìm thấy.
 */
export const fetchUserInfo = async (token: string): Promise<UserInfo | null> => {
    logToFile(`[API Client] Attempting to fetch user info.`);

    if (!token) {
        logToFile('[API Client] fetchUserInfo called with no token.');
        return null;
    }

    // --- Bước 1: Kiểm tra /user/me ---
    const userMeUrl = `${DATABASE_URL}/user/me`;
    logToFile(`[API Client] Checking user info from: ${userMeUrl}`);

    try {
        const userMeResponse = await axios.get<UserInfo>(userMeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            timeout: 5000
        });

        if (userMeResponse.status === 200 && userMeResponse.data && userMeResponse.data.id) {
            logToFile(`[API Client] Successfully fetched user info from /user/me for ID: ${userMeResponse.data.id}`);
            // Nếu tìm thấy user, trả về thông tin user
            return userMeResponse.data;
        } else {
            logToFile(`[API Client] No user found at ${userMeUrl}. Status: ${userMeResponse.status}`);
            // Tiếp tục kiểm tra admin nếu /user/me không trả về user
        }

    } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response && (axiosError.response.status === 401 || axiosError.response.status === 403 || axiosError.response.status === 404)) {
            // Các lỗi 4xx thường chỉ ra rằng user không tồn tại hoặc không được phép truy cập /user/me
            logToFile(`[API Client] User authentication failed or user not found at ${userMeUrl}. Status: ${axiosError.response.status}`);
            // Tiếp tục kiểm tra admin
        } else if (axiosError.request) {
            logToFile(`[API Client] Network or timeout error fetching from ${userMeUrl}: ${axiosError.message}`);
            // Nếu có lỗi mạng, có thể server không phản hồi, không thể kiểm tra admin. Trả về null.
            return null;
        } else {
            logToFile(`[API Client] Error fetching from ${userMeUrl}: Request setup error. ${axiosError.message}`);
            // Lỗi khác, không thể kiểm tra admin. Trả về null.
            return null;
        }
    }

    // --- Bước 2: Nếu không tìm thấy user ở /user/me, kiểm tra /auth/admin/me ---
    const adminMeUrl = `${DATABASE_URL}/auth/admin/me`;
    logToFile(`[API Client] Checking admin info from: ${adminMeUrl}`);

    try {
        const adminMeResponse = await axios.get<UserInfo>(adminMeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            timeout: 5000
        });

        if (adminMeResponse.status === 200 && adminMeResponse.data && adminMeResponse.data.id) {
            logToFile(`[API Client] Successfully fetched admin info from ${adminMeUrl} for ID: ${adminMeResponse.data.id}`);
            // Nếu tìm thấy admin, trả về thông tin admin
            return adminMeResponse.data;
        } else {
            logToFile(`[API Client] No admin found at ${adminMeUrl}. Status: ${adminMeResponse.status}`);
            // Nếu không tìm thấy admin, trả về null
            return null;
        }

    } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
            // Lỗi từ phía server API (4xx, 5xx) khi gọi admin endpoint
            logToFile(`[API Client] Error fetching admin info. Status: ${axiosError.response.status}, Data: ${JSON.stringify(axiosError.response.data)}`);
        } else if (axiosError.request) {
            // Request đã gửi nhưng không nhận được response (network error, timeout)
            logToFile(`[API Client] Error fetching admin info: No response received from ${adminMeUrl}. ${axiosError.message}`);
        } else {
            // Lỗi khác khi setup request
            logToFile(`[API Client] Error fetching admin info: Request setup error for ${adminMeUrl}. ${axiosError.message}`);
        }
        // Trả về null khi có lỗi hoặc không phải admin
        return null;
    }
};