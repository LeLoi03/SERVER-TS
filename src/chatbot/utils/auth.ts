// src/utils/apiClient.ts
import { container } from 'tsyringe';
import axios, { AxiosError } from 'axios';
import logToFile from '../../utils/logger'; // Đã cập nhật đường dẫn tới logger
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import getErrorMessageAndStack

import { ConfigService } from '../../config/config.service';

const configService = container.resolve(ConfigService);

// --- Lấy cấu hình từ ConfigService ---
const DATABASE_URL = configService.databaseUrl;
if (!DATABASE_URL) {
    // Đây là lỗi cấu hình nghiêm trọng, nên log FATAL và throw error
    logToFile(`[FATAL ERROR] [API Client] DATABASE_URL is not configured. Aborting application startup.`);
    throw new Error("DATABASE_URL is not configured. Please set it in your environment variables.");
}


/**
 * Định nghĩa kiểu dữ liệu trả về từ API /me và /auth/admin/me
 */
export interface UserInfo {
    id: string;
    email: string;
    role: string;
}

/**
 * Gọi API để lấy thông tin người dùng từ token.
 * Trước tiên kiểm tra /user/me. Nếu không có user (hoặc lỗi 4xx), kiểm tra /auth/admin/me.
 * Trả về thông tin người dùng (admin hoặc user) nếu tìm thấy, ngược lại trả về null.
 *
 * @param {string} token - JWT token của người dùng.
 * @returns {Promise<UserInfo | null>} Promise chứa thông tin UserInfo (có thể là admin hoặc user) hoặc null nếu không tìm thấy.
 */
export const fetchUserInfo = async (token: string): Promise<UserInfo | null> => {
    const logContext = '[API Client][fetchUserInfo]';
    logToFile(`${logContext} Attempting to fetch user info.`);

    if (!token) {
        logToFile(`${logContext} Called with no token. Returning null.`);
        return null;
    }

    // --- Bước 1: Kiểm tra /user/me ---
    const userMeUrl = `${DATABASE_URL}/user/me`;
    logToFile(`${logContext} Checking user info from: ${userMeUrl}`);

    try {
        const userMeResponse = await axios.get<UserInfo>(userMeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            timeout: 5000 // 5 seconds timeout
        });

        if (userMeResponse.status === 200 && userMeResponse.data && userMeResponse.data.id) {
            logToFile(`${logContext} Successfully fetched user info from /user/me for ID: ${userMeResponse.data.id}. Role: ${userMeResponse.data.role}`);
            return userMeResponse.data; // User found and valid, return it
        } else {
            // This path indicates a 200 OK but with unexpected data, or status other than 200 that wasn't an error.
            // In Axios, non-2xx status codes typically throw, so this else branch is less likely for non-200.
            // If userMeResponse.data is null or id is missing, it's still not a valid user for our purpose.
            logToFile(`${logContext} No valid user data found at ${userMeUrl} despite status ${userMeResponse.status}. Attempting admin check.`);
        }

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        const axiosError = error instanceof AxiosError ? error : null; // Check if it's an AxiosError

        if (axiosError && axiosError.response) {
            const status = axiosError.response.status;
            // 401 (Unauthorized) or 403 (Forbidden) or 404 (Not Found) for /user/me
            // often means the user is not a regular user, or token is bad, but might be an admin.
            if (status === 401 || status === 403 || status === 404) {
                logToFile(`${logContext} User authentication failed or user not found at ${userMeUrl}. Status: ${status}. Attempting admin check.`);
            } else {
                // Other server errors (e.g., 5xx, or unexpected 4xx) from /user/me API
                logToFile(`[ERROR] ${logContext} Server responded with error from ${userMeUrl}. Status: ${status}, Message: "${errorMessage}". Stack: ${errorStack}`);
                return null; // A server error suggests the auth system is down, don't try admin
            }
        } else if (axiosError && axiosError.request) {
            // The request was made but no response was received (e.g., network error, timeout).
            logToFile(`[ERROR] ${logContext} Network or timeout error fetching from ${userMeUrl}: "${errorMessage}". Stack: ${errorStack}`);
            return null; // Network issue, unlikely to reach admin endpoint either.
        } else {
            // Something happened in setting up the request that triggered an Error
            logToFile(`[ERROR] ${logContext} Error setting up request for ${userMeUrl}: "${errorMessage}". Stack: ${errorStack}`);
            return null; // Other error, cannot proceed.
        }
    }

    // --- Bước 2: Nếu không tìm thấy user ở /user/me, kiểm tra /auth/admin/me ---
    const adminMeUrl = `${DATABASE_URL}/auth/admin/me`;
    logToFile(`${logContext} Checking admin info from: ${adminMeUrl}`);

    try {
        const adminMeResponse = await axios.get<UserInfo>(adminMeUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            timeout: 5000
        });

        if (adminMeResponse.status === 200 && adminMeResponse.data && adminMeResponse.data.id) {
            logToFile(`${logContext} Successfully fetched admin info from ${adminMeUrl} for ID: ${adminMeResponse.data.id}. Role: ${adminMeResponse.data.role}`);
            return adminMeResponse.data; // Admin found and valid, return it
        } else {
            // This path indicates a 200 OK but with unexpected data, or status other than 200 that wasn't an error.
            logToFile(`${logContext} No valid admin data found at ${adminMeUrl} despite status ${adminMeResponse.status}. Returning null.`);
            return null;
        }

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        const axiosError = error instanceof AxiosError ? error : null;

        if (axiosError && axiosError.response) {
            const status = axiosError.response.status;
            // 401/403/404 for /auth/admin/me means the token is not for an admin or is invalid.
            logToFile(`${logContext} Admin authentication failed or admin not found at ${adminMeUrl}. Status: ${status}. Message: "${errorMessage}".`);
        } else if (axiosError && axiosError.request) {
            // No response received (network error, timeout) for admin endpoint.
            logToFile(`[ERROR] ${logContext} Network or timeout error fetching from ${adminMeUrl}: "${errorMessage}". Stack: ${errorStack}`);
        } else {
            // Other errors during request setup for admin endpoint.
            logToFile(`[ERROR] ${logContext} Error setting up request for ${adminMeUrl}: "${errorMessage}". Stack: ${errorStack}`);
        }
        return null; // No user/admin found after checking both endpoints or a critical error occurred.
    }
};