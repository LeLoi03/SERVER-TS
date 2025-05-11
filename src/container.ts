// src/container.ts (or wherever you do your DI setup)
import 'reflect-metadata';
import { container } from 'tsyringe';

// Config and Core Services
import { ConfigService } from './config/config.service';
import { LoggingService } from './services/logging.service';
import { ApiKeyManager } from './services/apiKey.manager';
import { PlaywrightService } from './services/playwright.service';
import { FileSystemService } from './services/fileSystem.service';
import { GeminiApiService } from './services/geminiApi.service';
import { TaskQueueService } from './services/taskQueue.service';

// --- Your Newly Refactored Batch Processing Sub-Services ---
import { PageContentExtractorService, IPageContentExtractorService } from './services/batchProcessingServiceChild/pageContentExtractor.service';
import { ConferenceLinkProcessorService, IConferenceLinkProcessorService } from './services/batchProcessingServiceChild/conferenceLinkProcessor.service';
import { ConferenceDeterminationService, IConferenceDeterminationService } from './services/batchProcessingServiceChild/conferenceDetermination.service';
import { ConferenceDataAggregatorService, IConferenceDataAggregatorService } from './services/batchProcessingServiceChild/conferenceDataAggregator.service';
// --- The Orchestrating BatchProcessingService ---
import { BatchProcessingService } from './services/batchProcessing.service'; // Corrected

// Other Application Services
import { HtmlPersistenceService } from './services/htmlPersistence.service';
import { ResultProcessingService } from './services/resultProcessing.service';
import { ConferenceProcessorService } from './services/conferenceProcessor.service';
import { CrawlOrchestratorService } from './services/crawlOrchestrator.service';

// Register Core Services (assuming they are singletons)
container.registerSingleton(ConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(ApiKeyManager);
container.registerSingleton(PlaywrightService);
container.registerSingleton(FileSystemService);
container.registerSingleton(GeminiApiService);
container.registerSingleton(TaskQueueService);

// Register New Batch Processing Sub-Services (usually as singletons if stateless or state is app-wide)
container.registerSingleton<IPageContentExtractorService>('IPageContentExtractorService', PageContentExtractorService);
container.registerSingleton<IConferenceLinkProcessorService>('IConferenceLinkProcessorService', ConferenceLinkProcessorService);
container.registerSingleton<IConferenceDeterminationService>('IConferenceDeterminationService', ConferenceDeterminationService);
container.registerSingleton<IConferenceDataAggregatorService>('IConferenceDataAggregatorService', ConferenceDataAggregatorService);

// Register the Orchestrating BatchProcessingService
container.registerSingleton(BatchProcessingService); // This will inject the sub-services above

// Register Other Application Services
container.registerSingleton(HtmlPersistenceService);
container.registerSingleton(ResultProcessingService);
// ConferenceProcessorService might be transient if it holds per-conference state,
// or singleton if its state is managed via parameters. Based on your current code, it's resolved per task.
// If ConferenceProcessorService is resolved dynamically per task as in your CrawlOrchestratorService,
// you just need to ensure its dependencies are registered.
// `container.resolve(ConferenceProcessorService)` will work if ConferenceProcessorService and its dependencies are registered.
// If it's always new instance per conference:
container.register(ConferenceProcessorService, ConferenceProcessorService); // or simply ensure it's @injectable() if no interface

container.registerSingleton(CrawlOrchestratorService);


// Export the configured container if needed elsewhere, though usually not necessary
// as components will use @inject or container.resolve() directly.
export default container;