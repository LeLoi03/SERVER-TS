import {
    FunctionDeclaration,
    Type
} from "@google/genai";


// English

// --- New Function Declaration for Host Agent ---
export const englishRouteToAgentDeclaration: FunctionDeclaration = {
    name: "routeToAgent",
    description: "Routes a specific task to a designated specialist agent.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            targetAgent: {
                type: Type.STRING,
                description: "The unique identifier of the specialist agent to route the task to (e.g., 'ConferenceAgent').",
            },
            taskDescription: {
                type: Type.STRING,
                description: "A details natural language description of the task for the target agent.",
            }
        },
        required: ["targetAgent", "taskDescription"],
    },
};

export const englishGetConferencesDeclaration: FunctionDeclaration = {
    name: "getConferences",
    description: "Searches for conferences by generating a URL-encoded query string based on specified criteria. This function is used to find any information about conferences.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            searchQuery: {
                type: Type.STRING,
                description: "A URL-encoded query string constructed from the user's search criteria (e.g., 'acronym=ICML&country=Vietnam&perPage=5'). Refer to the system instructions for detailed construction rules, available keys, and examples."
            }
        },
        required: ["searchQuery"]
    }
};

export const englishGetWebsiteInfoDeclaration: FunctionDeclaration = {
    name: "getWebsiteInfo",
    description: "Retrieves information about websites. This function don't need parameters, just call it"
};

export const englishDrawChartDeclaration: FunctionDeclaration = {
    name: "drawChart",
    description: "Draws a chart based on the provided data.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            chartType: {
                type: Type.STRING,
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
    '/chatbot/landingchatbot',
    '/chatbot/regularchat',
    '/chatbot/livechat',
    '/chatbot/history',
    //'/visualization/landingvisualization',
    '/visualization',
    '/support',
    '/other',
    '/addconference',
    '/conferences/detail',
    '/journals/detail',
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/updateconference'
];

export const englishNavigationDeclaration: FunctionDeclaration = {
    name: "navigation",
    description: `Navigates the user to a specified page within this website or to an external conference website by opening a new browser tab.
    - For INTERNAL navigation: Provide the relative path starting with '/'. The system will automatically add the base URL and locale. Allowed internal paths are: ${internalPaths.join(', ')}.
    - Specifically for the '/dashboard' path, you can navigate to specific tabs by appending '?tab=' followed by the tab name. Allowed dashboard tabs are: 'profile', 'myconferences', 'followed', 'note' (calendar page), 'notifications', 'blacklisted', 'setting'. Example for navigating to the profile tab: {"url": "/dashboard?tab=profile"}.
    - For EXTERNAL conference sites: Provide the full, valid URL starting with 'http://' or 'https://'.`,
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: {
                type: Type.STRING,
                description: `The internal path (starting with '/', e.g., '/dashboard?tab=profile') or the full external URL (starting with 'http://' or 'https://', e.g., 'https://some-conference.com/article') to navigate to.`
            }
        },
        required: ["url"]
    }
};

export const englishOpenGoogleMapDeclaration: FunctionDeclaration = {
    name: "openGoogleMap",
    description: "Opens Google Maps in a new browser tab directed to a specific location string (e.g., city, address, landmark).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            location: {
                type: Type.STRING,
                description: "The geographical location string to search for on Google Maps (e.g., 'Delphi, Greece', 'Eiffel Tower, Paris', '1600 Amphitheatre Parkway, Mountain View, CA').",
            },
        },
        required: ["location"],
    },
};



// Định nghĩa hàm manageFollow (giữ nguyên)
export const englishManageFollowDeclaration: FunctionDeclaration = {
    name: "manageFollow",
    description: "Follows, unfollows, or lists followed conferences for the user.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            itemType: {
                type: Type.STRING,
                description: "The type of item.",
                enum: ["conference"]
            },
            action: {
                type: Type.STRING,
                description: "The desired action: 'follow', 'unfollow', or 'list'.",
                enum: ["follow", "unfollow", "list"]
            },
            identifier: { // Optional when action is 'list'
                type: Type.STRING,
                description: "A unique identifier for the item (e.g., acronym, title, ID). Required for 'follow'/'unfollow'.",
            },
            identifierType: { // Optional when action is 'list'
                 type: Type.STRING,
                 description: "The type of the identifier. Required for 'follow'/'unfollow'.",
                 enum: ["acronym", "title", "id"],
            },
        },
        required: ["itemType", "action"],
    },
};

// Định nghĩa hàm manageCalendar (giữ nguyên)
export const englishManageCalendarDeclaration: FunctionDeclaration = {
    name: "manageCalendar",
    description: "Adds, removes, or lists conferences in the user's calendar.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            itemType: {
                type: Type.STRING,
                description: "The type of item. Must be 'conference' for calendar actions.",
                enum: ["conference"]
            },
            action: {
                type: Type.STRING,
                description: "The desired action: 'add', 'remove', or 'list'.",
                enum: ["add", "remove", "list"]
            },
            identifier: { // Optional when action is 'list'
                type: Type.STRING,
                description: "A unique identifier for the conference. Required for 'add'/'remove'.",
            },
             identifierType: { // Optional when action is 'list'
                 type: Type.STRING,
                 description: "The type of the identifier. Required for 'add'/'remove'.",
                 enum: ["acronym", "title", "id"],
            },
        },
        required: ["itemType", "action"],
    },
};


// Định nghĩa hàm manageBlacklist
export const englishManageBlacklistDeclaration: FunctionDeclaration = {
    name: "manageBlacklist",
    description: "Adds, removes, or lists conferences in the user's blacklist.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            itemType: {
                type: Type.STRING,
                description: "The type of item. Must be 'conference' for blacklist actions.",
                enum: ["conference"]
            },
            action: {
                type: Type.STRING,
                description: "The desired action: 'add', 'remove', or 'list'.",
                enum: ["add", "remove", "list"]
            },
            identifier: { // Optional when action is 'list'
                type: Type.STRING,
                description: "A unique identifier for the conference. Required for 'add'/'remove'.",
            },
             identifierType: { // Optional when action is 'list'
                 type: Type.STRING,
                 description: "The type of the identifier. Required for 'add'/'remove'.",
                 enum: ["acronym", "title", "id"],
            },
        },
        required: ["itemType", "action"],
    },
};

export const englishSendEmailToAdminDeclaration: FunctionDeclaration = {
    name: "sendEmailToAdmin",
    description: "Sends an email to the website administrator on behalf of the user. Use this function when the user explicitly wants to contact the admin, report an issue, provide feedback, or request specific help that requires admin intervention. You should help the user formulate the subject, message, and confirm the request type ('contact' or 'report') before calling this function.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            subject: {
                type: Type.STRING,
                description: "The subject line for the email to the admin. Should be concise and reflect the email's purpose.",
            },
            requestType: {
                type: Type.STRING,
                description: "The type of request. Use 'contact' for general inquiries, feedback, or contact requests. Use 'report' for reporting issues, errors, or problems with the website or its content.",
                enum: ["contact", "report"], // Specify allowed values
            },
            message: {
                type: Type.STRING,
                description: "The main body/content of the email message detailing the user's request, report, or feedback.",
            },
        },
        required: ["subject", "requestType", "message"], // All fields are mandatory
    },
};