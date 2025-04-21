import { executeApiCall } from './backendService';
import { ApiCallResult } from '../shared/types';

export async function executeGetJournals(searchQuery: string): Promise<ApiCallResult> {
    // Assuming journal transformation is not yet implemented or needed for link extraction only
    return executeApiCall('journal', searchQuery); // Will likely have formattedData=null
}