import {PrismaClient} from '../../../generated/prisma_client';


export type ConferenceImport = {
    title : string ;
    acronym : string ; 
    source : string ; 
    rank : string
    fieldOfResearchCode : string[];
}

export async function importConference (importData : ConferenceImport, userId : string) {
    const prisma = new PrismaClient();
    const {title, acronym, source, rank, fieldOfResearchCode} = importData;

    const conferenceId = await findOrCreateConference(title, acronym, userId); // Replace 'userId' with actual user ID
    
    const sourceId = await findOrCreateSource(source);
    const rankId = await findOrCreateRank(rank, sourceId);
    const fieldOfResearchIds = await Promise.all(fieldOfResearchCode.map(code => findOrCreateFieldOfResearch(code)));

    for (const fieldOfResearchId of fieldOfResearchIds) {
        await prisma.conferenceRanks.create({
            data : {
                conferenceId : conferenceId,
                rankId : rankId,
                fieldOfResearchId : fieldOfResearchId,
                year : new Date().getFullYear(), // Current year
            }
        })
    }
}

export async function findOrCreateSource (source : string) {
    const prisma = new PrismaClient();
    const conferenceSource = await prisma.sources.findFirst({
        where : {
            name : source
        }
    })

    if (!conferenceSource) {
        const newSource = await prisma.sources.create({
            data : {
                name : source,
                link : '', 
            }
        })
        return newSource.id;
    } else {
        return conferenceSource.id;
    }
}

export async function findOrCreateRank (rankName : string , sourceId : string) {
    const prisma = new PrismaClient();
    const rank = await prisma.ranks.findFirst({
        where : {
            name : rankName,
            sourceId : sourceId
        }
    })

    if (!rank) {
        const newRank = await prisma.ranks.create({
            data : {
                name : rankName,
                sourceId : sourceId,
                value : 0,
            }
        })
        return newRank.id;
    } else {
        return rank.id;
    }
}

export async function findOrCreateFieldOfResearch (fieldOfResearchCode : string) {
    const prisma = new PrismaClient();
    const fieldOfResearch = await prisma.fieldOfResearchs.findFirst({
        where : {
            code : fieldOfResearchCode
        }
    })

    if (!fieldOfResearch) {
        const newFieldOfResearch = await prisma.fieldOfResearchs.create({
            data : {
                code : fieldOfResearchCode,
                name : 'UNKNOW SOURCE', // Add a default name or leave it empty
            }
        })
        return newFieldOfResearch.id;
    } else {
        return fieldOfResearch.id;
    }
}

export async function findOrCreateConference (title : string, acronym : string, userId : string) {
    const prisma = new PrismaClient();
    const conference = await prisma.conferences.findFirst({
        where : {
            title : title,
            acronym : acronym
        }
    })

    if (!conference) {
        const newConference = await prisma.conferences.create({
            data : {
                title : title,
                acronym : acronym,
                creatorId : userId,
                status : 'IMPORTED' // Get user ID from request
            }
        })
        return newConference.id;
    } else {
        return conference.id;
    }
}
