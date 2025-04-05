import {PrismaClient} from '../../generated/prisma_client';
import { converStringToDate, convertObjectToDate } from '../utils/parseDaterange';
import { ProcessedRowData } from './types';

export const findOrCreateConference = async (input : ProcessedRowData ,userId : string) => {
    const prisma = new PrismaClient();
    const { acronym, title } = input;
    try {
        // Check if the conference already exists
        let conference = await prisma.conferences.findFirst({
            where: {
                acronym: acronym,
                title: title,
            },
        });

        // If it doesn't exist, create it
        if (!conference) {
            conference = await prisma.conferences.create({
                data: {
                    acronym: acronym,
                    title: title,
                    creatorId : userId,
                    status : 'DRAFT'
                },
            });
        }

        return conference;
    } catch (error) {
        console.error('Error finding or creating conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export const createConfereneOrganization = async (input : ProcessedRowData , conferenceId : string) => {
    const prisma = new PrismaClient();

    try {
        const found = await findConferenceById(conferenceId);
        if (!found) {
            throw new Error(`Conference with ID ${conferenceId} not found.`);
        }
        const conferenceOrganization = await prisma.conferenceOrganizations.create({
            data : {
                year : parseInt(input.year),
                conferenceId : conferenceId,
                isAvailable : true,
                accessType : input.type, 
                publisher : input.publisher,
                summerize : input.summary, 
                callForPaper : input.callForPapers,
                link : input.link,
                cfpLink : input.cfpLink,
                impLink : input.impLink,
            }
        })
        return conferenceOrganization;

    } catch (error) {
        console.error('Error finding or creating conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export const findConferenceById = async (id : string) => { 
    const prisma = new PrismaClient();
    try {
        const conference = await prisma.conferences.findUnique({
            where: {
                id: id,
            },
        });

        return conference;
    } catch (error) {
        console.error('Error finding conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export const createLocation = async (input : ProcessedRowData , organizationId : string) => {
    const prisma = new PrismaClient();

    try {
        const found = await findOrganizationById(organizationId);
        if (!found) {
            throw new Error(`Conference with ID ${organizationId} not found.`);
        }
        const location = await prisma.locations.create({
            data : {
                cityStateProvince : input.cityStateProvince,
                country : input.country,
                continent : input.continent,
                organizeId : organizationId,
                isAvailable : true,
            }
        })
        return location;

    } catch (error) {
        console.error('Error finding or creating conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export const createTopic = async (input : ProcessedRowData , organizationId : string) => {
    const prisma = new PrismaClient();

    try {
        const found = await findOrganizationById(organizationId);
        if (!found) {
            throw new Error(`Conference with ID ${organizationId} not found.`);
        }
        const topicsToImport = input.topics.split(',').map(topic => topic.trim());
        const topicsInDb = await prisma.topics.findMany({}) ; 
        const newTopics = topicsToImport.filter(topic => !topicsInDb.some(existingTopic => existingTopic.name === topic));
        if (newTopics.length === 0) {
            console.log('No new topics to create.');
            return [];
        }
        const createdTopics = await prisma.topics.createManyAndReturn({
            data: newTopics.map(topic => ({
                name: topic
            })),
        });

        const mapToOrg = await prisma.conferenceTopics.createManyAndReturn({
            data: createdTopics.map((topic) : {organizeId : string , topicId : string} => ({
                topicId: topic.id,
                organizeId: organizationId,
            })),
        });
        return createdTopics;

    } catch (error) {
        console.error('Error finding or creating conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}



export const findOrganizationById = async (id : string) => {
    const prisma = new PrismaClient();
    try {
        const organization = await prisma.conferenceOrganizations.findUnique({
            where: {
                id: id,
            },
        });

        return organization;
    } catch (error) {
        console.error('Error finding organization:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export const createConferenceDate = async (input : ProcessedRowData , organizationId : string) => {
    const prisma = new PrismaClient();

    try {
        const conferenceDate = converStringToDate(input.conferenceDates , 'conferenceDate', organizationId);
        const submissionDates = convertObjectToDate(input.submissionDate , 'submissionDate', organizationId);
        const cameraReadyDates = convertObjectToDate(input.cameraReadyDate , 'cameraReadyDate', organizationId);
        const notificationDates = convertObjectToDate(input.notificationDate , 'notificationDate', organizationId);
        const otherDates = convertObjectToDate(input.otherDate , 'otherDate', organizationId);
        
        const conferneceDateSave = await prisma.conferenceDates.createManyAndReturn({
            data : [
                conferenceDate,
                ...submissionDates,
                ...cameraReadyDates,
                ...notificationDates,
                ...otherDates
            ]
        })

        return conferneceDateSave;

    } catch (error) {
        console.error('Error finding or creating conference:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}