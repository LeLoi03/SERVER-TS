import { executeApiCall } from './backendService';
import { ApiCallResult } from '../shared/types';



export async function executeGetConferences(searchQuery: string): Promise<ApiCallResult> {
    return executeApiCall('conference', searchQuery);
}