import {
    FunctionDeclaration,
    SchemaType,
} from "@google/generative-ai";


// English

// --- New Function Declaration for Host Agent ---
export const englishRouteToAgentDeclaration: FunctionDeclaration = {
    name: "routeToAgent",
    description: "Routes a specific task to a designated specialist agent.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            targetAgent: {
                type: SchemaType.STRING,
                description: "The unique identifier of the specialist agent to route the task to (e.g., 'ConferenceAgent').",
            },
            taskDescription: {
                type: SchemaType.STRING,
                description: "A details natural language description of the task for the target agent.",
            }
        },
        required: ["targetAgent", "taskDescription"],
    },
};

export const englishGetConferencesDeclaration: FunctionDeclaration = {
    name: "getConferences",
    // Mô tả rõ mục đích là tạo query string
    description: "Generates a URL-encoded query string to search for conferences based on user-specified criteria. This query string will be used to fetch data from the backend API." +
        " It is crucial that *all* values in the query string are properly URL-encoded to ensure the backend API correctly interprets the search criteria. Failure to properly encode values can lead to incorrect search results or errors." +
        " Be mindful of the maximum length of a URL, as excessively long query strings may be truncated by browsers or servers. Consider limiting the number of `topics` or `researchFields` parameters if necessary." +
        " The backend API may be case-sensitive for certain parameters (e.g., `country`, `continent`). Ensure the casing of the values matches the expected format." +
        " A comprehensive example combining multiple criteria: `title=International+Conference+on+AI&topics=AI&topics=Machine+Learning&country=USA&fromDate=2024-01-01&toDate=2024-12-31&rank=A*`",
    parameters: {
        type: SchemaType.OBJECT, // Vẫn là OBJECT theo cấu trúc chung
        properties: {
            // Định nghĩa một tham số duy nhất để chứa query string
            searchQuery: {
                type: SchemaType.STRING,
                // Hướng dẫn chi tiết cách tạo query string
                description: "A URL-encoded query string constructed from the user's search criteria for conferences. Format as key=value pairs separated by '&'. " +
                    "Available keys based on potential user queries include: " +
                    "`title` (string):  The full, formal name of the conference.(e.g., International Conference on Management of Digital EcoSystems) " +
                    "`acronym` (string): The abbreviated name of the conference, often represented by capital letters (e.g., ICCCI, SIGGRAPH, ABZ). " +
                    "`fromDate` (string, e.g., YYYY-MM-DD), " +
                    "`toDate` (string, e.g., YYYY-MM-DD), " +
                    "`topics` (string, repeat key for multiple values, e.g., topics=AI&topics=ML), " +
                    "`cityStateProvince` (string), " +
                    "`country` (string), " +
                    "`continent` (string), " +
                    "`address` (string), " +
                    "`researchFields` (string, repeat key for multiple values), " +
                    "`rank` (string), " +
                    "`source` (string), " +
                    "`accessType` (string), " +
                    "`keyword` (string), " +
                    "`subFromDate` (string), `subToDate` (string), " +
                    "`cameraReadyFromDate` (string), `cameraReadyToDate` (string), " +
                    "`notificationFromDate` (string), `notificationToDate` (string), " +
                    "`registrationFromDate` (string), `registrationToDate` (string), " +
                    "`mode` (string): If the user requests detailed information, the value is always `detail`. " +
                    "`perPage` (number):  The number of conferences to return per page. If the user specifies a number, use that value. If the user doesn't specify a number, default to 5." +
                    "`page` (number):  The page number of the results to return. If the user wants to see the next set of conferences, use page=2, page=3, etc. If the user doesn't specify a page number, default to 1." +
                    "Ensure all values are properly URL-encoded (e.g., spaces become + or +). " +

                    "**Distinguishing between Title and Acronym:** It is crucial to correctly identify whether the user is providing the full conference title or the acronym.  Here's how to differentiate them:" +
                    "* **Title:** This is the complete, unabbreviated name of the conference.  It is typically a phrase or sentence that describes the conference's focus. Example: 'International Conference on Machine Learning'.  Use the `title` parameter for this." +
                    "* **Acronym:** This is a short, usually capitalized, abbreviation of the conference name. Example: 'ICML' (for International Conference on Machine Learning).  Use the `acronym` parameter for this." +

                    "**Examples:**" +
                    "* User query: 'Find conferences about ICML'.  `searchQuery=acronym=ICML&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Search for the International Conference on Management of Digital EcoSystems'. `searchQuery=title=International+Conference+on+Management+of+Digital+EcoSystems&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Find MEDES conferences'. `searchQuery=acronym=MEDES&perPage=5&page=1` (Default perPage and page)" +
                    "* User query: 'Search for conferences with the full name International Conference on Recent Trends in Image Processing, Pattern Recognition and Machine Learning'. `searchQuery=title=International+Conference+on+Recent+Trends+in+Image+Processing,+Pattern+Recognition+and+Machine+Learning&perPage=5&page=1` (Default perPage and page)" +
                    "* User query 1: 'Find 3 conferences in USA'. `searchQuery=country=USA&perPage=3&page=1` User query 2: 'Find 5 different conferences in USA'. `searchQuery=country=USA&perPage=5&page=2`" +

                    "For example, if a topic contains both spaces and special characters, like 'Data Science & Analysis', it should be encoded as 'Data+Science+&+Analysis'. " +
                    "If a user doesn't specify a value for a particular key, it should be omitted entirely from the query string.  Do not include keys with empty values (e.g., `title=`). " +
                    "To specify multiple topics or research fields, repeat the key for each value. For example: `topics=AI&topics=Machine+Learning&researchFields=Computer+Vision&researchFields=Natural+Language+Processing`. " +
                    "Always URL-encode special characters in values. For example, use `+` for spaces, `&` for ampersands, `=` for equals signs, and `+` for plus signs. " +
                    "To search for conferences between two dates, use `fromDate` and `toDate`. For example, to search for conferences happening between January 1, 2023, and December 31, 2023, use `fromDate=2023-01-01&toDate=2023-12-31`. " +
                    "If the user requests *detailed* information about the conferences (e.g., full descriptions, specific dates, call for papers, summary, etc.), include the parameter `mode=detail` in the query string."
            }
        },
        // Đảm bảo Gemini luôn cung cấp tham số này
        required: ["searchQuery"]
    }
};

export const englishGetJournalsDeclaration: FunctionDeclaration = {
    name: "getJournals",
    description: "Retrieves information about journals based on filtering criteria.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            "Rank": {
                "type": SchemaType.ARRAY,
                "description": "List of journal ranks to filter by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "Title": {
                "type": SchemaType.ARRAY,
                "description": "List of journal titles to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Issn": {
                "type": SchemaType.ARRAY,
                "description": "List of journal ISSNs to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "SJR": {
                "type": SchemaType.ARRAY,
                "description": "List of journal SJR values to filter by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SJRBestQuartile": {
                "type": SchemaType.ARRAY,
                "description": "List of journal SJR Best Quartile values to filter by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "HIndex": {
                "type": SchemaType.INTEGER,
                "description": "Journal H index to filter by."
            },
            "Country": {
                "type": SchemaType.ARRAY,
                "description": "List of countries to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Region": {
                "type": SchemaType.ARRAY,
                "description": "List of regions to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Publisher": {
                "type": SchemaType.ARRAY,
                "description": "List of publishers to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Areas": {
                "type": SchemaType.ARRAY,
                "description": "List of areas to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Categories": {
                "type": SchemaType.ARRAY,
                "description": "List of categories to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Overton": {
                "type": SchemaType.ARRAY,
                "description": "List of Overton values to filter journals by.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SDG": {
                "type": SchemaType.ARRAY,
                "description": "List of SDGs to filter journals by.",
                "items": {
                    "type": SchemaType.STRING
                }
            }
        }
    },
};

export const englishGetWebsiteInfoDeclaration: FunctionDeclaration = {
    name: "getWebsiteInfo",
    description: "Retrieves information about websites. This function don't need parameters, just call it"
};

export const englishDrawChartDeclaration: FunctionDeclaration = {
    name: "drawChart",
    description: "Draws a chart based on the provided data.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chartType: {
                type: SchemaType.STRING,
                description: "The type of chart (e.g., bar, line, pie).",
            }
        },
        required: ["chartType"],
    },
};

const internalPaths = [
    '/',
    '/conferences',
    '/dashboard',
    '/journals',
    '/chatbot',
    '/visualization',
    '/chatbot/chat',
    '/chatbot/livechat',
    '/support',
    '/other',
    '/addconference',
    // '/conferences/detail', 
    // '/journals/detail',    
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
    // '/updateconference'
];

export const englishNavigationDeclaration: FunctionDeclaration = {
    name: "navigation",
    description: `Navigates the user to a specified page within this website or to an external conference/journal website by opening a new browser tab.
    - For INTERNAL navigation: Provide the relative path starting with '/'. The system will automatically add the base URL and locale. Allowed internal paths are: ${internalPaths.join(', ')}. Example: {"url": "/conferences"}
    - For EXTERNAL conference/journal sites: Provide the full, valid URL starting with 'http://' or 'https://'.`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            url: {
                type: SchemaType.STRING,
                description: `The internal path (starting with '/', e.g., '/dashboard') or the full external URL (starting with 'http://' or 'https://', e.g., 'https://some-journal.com/article') to navigate to.`
            }
        },
        required: ["url"]
    }
};

export const englishOpenGoogleMapDeclaration: FunctionDeclaration = {
    name: "openGoogleMap",
    description: "Opens Google Maps in a new browser tab directed to a specific location string (e.g., city, address, landmark). Use this ONLY AFTER obtaining the location string, often from the 'getConferences' or 'getJournals' functions.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            location: {
                type: SchemaType.STRING,
                description: "The geographical location string to search for on Google Maps (e.g., 'Delphi, Greece', 'Eiffel Tower, Paris', '1600 Amphitheatre Parkway, Mountain View, CA').",
            },
        },
        required: ["location"],
    },
};

export const englishFollowUnfollowItemDeclaration: FunctionDeclaration = {
    name: "followUnfollowItem",
    description: "Follows or unfollows a specific conference or journal for the currently logged-in user. Requires identifying the item first (e.g., using getConferences/getJournals).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            itemType: {
                type: SchemaType.STRING,
                description: "The type of item.",
                enum: ["conference", "journal"]
            },
            identifier: {
                type: SchemaType.STRING,
                description: "A unique identifier for the item, such as its acronym or exact title, that was previously retrieved.",
            },
            identifierType: {
                 type: SchemaType.STRING,
                 description: "The type of the identifier provided.",
                 enum: ["acronym", "title", "id"], // Allow Model to specify if it knows the type
            },
            action: {
                type: SchemaType.STRING,
                description: "The desired action to perform.",
                enum: ["follow", "unfollow"]
            },
        },
        required: ["itemType", "identifier", "identifierType", "action"],
    },
};

export const englishSendEmailToAdminDeclaration: FunctionDeclaration = {
    name: "sendEmailToAdmin",
    description: "Sends an email to the website administrator on behalf of the user. Use this function when the user explicitly wants to contact the admin, report an issue, provide feedback, or request specific help that requires admin intervention. You should help the user formulate the subject, message, and confirm the request type ('contact' or 'report') before calling this function.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            subject: {
                type: SchemaType.STRING,
                description: "The subject line for the email to the admin. Should be concise and reflect the email's purpose.",
            },
            requestType: {
                type: SchemaType.STRING,
                description: "The type of request. Use 'contact' for general inquiries, feedback, or contact requests. Use 'report' for reporting issues, errors, or problems with the website or its content.",
                enum: ["contact", "report"], // Specify allowed values
            },
            message: {
                type: SchemaType.STRING,
                description: "The main body/content of the email message detailing the user's request, report, or feedback.",
            },
        },
        required: ["subject", "requestType", "message"], // All fields are mandatory
    },
};