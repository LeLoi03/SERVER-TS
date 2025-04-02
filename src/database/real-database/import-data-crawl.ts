import { PrismaClient } from "../../../generated/prisma_client";
export type ConferenceCrawlData = {
    "Conference dates": string;
    "Year": string;
    "Location": string;
    "City-State-Province": string;
    "Country": string;
    "Continent": string;
    "Type": string;
    "Submission Date": {
        [key: string]: string;
    };
    "Notification Date": {
        [key: string]: string;
    };
    "Camera-ready Date": {
        [key: string]: string;
    };
    "Registration Date": {
        [key: string]: string;
    };
    "Topics": string;
    "Publisher": string;
    "Summary": string;
    "Call for Papers": string;
    "Link": string;
    "cfpLink": string;
    "impLink": string;
}

export async function importConferenceCrawlData(conferenceData: ConferenceCrawlData,conferenceId: string) {
    const topics = importTopics(conferenceData);

    const organizations = await importConferenceOrganization(conferenceData, conferenceId);

    const conferenceTopics = await importConferenceTopics(organizations.id, await topics);

    const conferenceLocation = await importConferenceLocation(conferenceData, conferenceId);

    const conferenceDates = await importConferenceDates(conferenceData, conferenceId);


}


export async function importConferenceOrganization (conferenceData: ConferenceCrawlData, conferenceId : string) {
    const prisma = new PrismaClient();


    return await prisma.conferenceOrganizations.create({
        data : {
            year : parseInt(conferenceData["Year"]),
            accessType : conferenceData["Type"],
            publisher : conferenceData["Publisher"],
            callForPaper : conferenceData["Call for Papers"],
            summerize : conferenceData["Summary"],
            link : conferenceData["Link"],
            cfpLink : conferenceData["Call for Papers"],
            impLink : conferenceData["impLink"],
            isAvailable : true,
            conferenceId : conferenceId,
        }
    })
}

export async function importTopics (conferenceData: ConferenceCrawlData) {
    const prisma = new PrismaClient();
    const topics = conferenceData["Topics"].split(',').map(topic => topic.trim());
    const topicIds = await Promise.all(topics.map(async (topic) => {
        const existingTopic = await prisma.topics.findFirst({
            where : {
                name : topic
            }
        })
        if (!existingTopic) {
            const newTopic = await prisma.topics.create({
                data : {
                    name : topic,
                }
            })
            return newTopic.id;
        } else {
            return existingTopic.id;
        }
    }))
    return topicIds;
}

export async function importConferenceTopics (organizationId : string, topicIds : string[]) {
    const prisma = new PrismaClient();
    for (const topicId of topicIds) {
        await prisma.conferenceTopics.create({
            data : {
                organizeId : organizationId,
                topicId : topicId,
            }
        })
    }
}

export async function importConferenceLocation (conferenceData: ConferenceCrawlData, conferenceId : string) {
    const prisma = new PrismaClient();
    const location = conferenceData["Location"].split(',').map(location => location.trim());
    const cityStateProvince = conferenceData["City-State-Province"].split(',').map(location => location.trim());
    const country = conferenceData["Country"].split(',').map(location => location.trim());
    const continent = conferenceData["Continent"].split(',').map(location => location.trim());

    return await prisma.locations.create({
        data : {
            address : location[0],
            cityStateProvince : cityStateProvince[0],
            country : country[0],
            continent : continent[0],
            isAvailable : true,
            organizeId : conferenceId,
        }
    })
}

export async function importConferenceDates (conferenceData: ConferenceCrawlData, conferenceId : string) {
    const prisma = new PrismaClient();
    const conferenceDates = conferenceData["Conference dates"].split(',').map(date => date.trim());
    for (const date of conferenceDates) {
        await prisma.conferenceDates.create({
            data : {
                organizedId : conferenceId,
                fromDate : new Date(date).toISOString(),
                toDate : new Date(date).toISOString(),
                type : 'Conference',
                name : 'Conference',
                isAvailable : true,
            }
        })
    }
}
