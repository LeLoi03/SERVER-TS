import pandas as pd
import numpy as np
import pickle
from tqdm import tqdm
from sklearn.metrics.pairwise import cosine_similarity
import os
from dotenv import load_dotenv
from gemini_service import GeminiService

# --- LOAD ENVIRONMENT VARIABLES ---
load_dotenv()

# # --- CONFIGURATION ---
# CLUSTERING_FILE_PATH = 'user_clustering_results.pkl'
# DATASET_FILE_PATH = 'conference_reviews_dataset.csv'
# OUTPUT_SIMILARITY_PATH = 'user_similarity_scores.pkl'
# OUTPUT_EMBEDDINGS_PATH = 'user_review_embeddings.pkl'


DATASET_FILE_PATH = 'golden_dataset.csv'
CLUSTERING_FILE_PATH = 'golden_dataset_clustering_results.pkl'
OUTPUT_SIMILARITY_PATH = 'golden_dataset_similarity_scores.pkl'
OUTPUT_EMBEDDINGS_PATH = 'golden_dataset_embeddings.pkl'

# Gemini Configuration
GEMINI_ENV_PREFIX = "GEMINI_API_KEY_"
EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT"
EMBEDDING_DIM = 768
EMBEDDING_BATCH_SIZE = 50

# Influencer Configuration
# NUM_INFLUENCERS = 50
NUM_INFLUENCERS = 2

# --- Similarity Calculation Function ---
def calculate_pearson_sim(user1_ratings, user2_ratings):
    common_items_mask = (user1_ratings != 0) & (user2_ratings != 0)
    if np.sum(common_items_mask) < 2: return 0.0
    u1_common, u2_common = user1_ratings[common_items_mask], user2_ratings[common_items_mask]
    mean1, mean2 = u1_common.mean(), u2_common.mean()
    cov = np.sum((u1_common - mean1) * (u2_common - mean2))
    std1, std2 = np.sqrt(np.sum((u1_common - mean1)**2)), np.sqrt(np.sum((u2_common - mean2)**2))
    if std1 == 0 or std2 == 0: return 0.0
    pearson_sim = cov / (std1 * std2)
    return (np.nan_to_num(pearson_sim) + 1) / 2

def main():
    """Main function to run the Pearson-based similarity calculation process."""
    print("="*50)
    print("STEP 2: HYBRID SIMILARITY CALCULATION (Pearson Baseline)")
    print("="*50)

    print("Loading data and clustering results...")
    df = pd.read_csv(DATASET_FILE_PATH)
    with open(CLUSTERING_FILE_PATH, 'rb') as f:
        clustering_results = pickle.load(f)

    clusters = clustering_results['clusters']
    user_map = clustering_results['user_map']
    rating_matrix = clustering_results['rating_matrix']

    print(f"Defining top {NUM_INFLUENCERS} influencers based on activity...")
    user_activity = df['user_id'].value_counts()
    influencer_ids = user_activity.head(NUM_INFLUENCERS).index.tolist()
    influencer_indices = [user_map[uid] for uid in influencer_ids]

    # --- Generate User Review Embeddings with UPSERT LOGIC ---
    user_embeddings = {}
    if os.path.exists(OUTPUT_EMBEDDINGS_PATH):
        try:
            with open(OUTPUT_EMBEDDINGS_PATH, 'rb') as f:
                user_embeddings = pickle.load(f)
            print(f"Loaded {len(user_embeddings)} existing embeddings from '{OUTPUT_EMBEDDINGS_PATH}'.")
        except (pickle.UnpicklingError, EOFError):
            print(f"Warning: Embedding file '{OUTPUT_EMBEDDINGS_PATH}' is corrupted. Starting fresh.")
            user_embeddings = {}

    user_docs = df.groupby('user_id')['review'].apply(lambda reviews: ' '.join(reviews)).to_dict()
    existing_user_ids = set(user_embeddings.keys())
    all_user_ids = set(user_docs.keys())
    missing_user_ids = list(all_user_ids - existing_user_ids)
    
    if not missing_user_ids:
        print("All user embeddings are already present. Skipping generation.")
    else:
        print(f"Found {len(missing_user_ids)} users needing embeddings. Starting generation...")
        gemini_service = GeminiService(
            env_prefix=GEMINI_ENV_PREFIX, 
            model=EMBEDDING_MODEL, 
            task_type=EMBEDDING_TASK_TYPE,
            dim=EMBEDDING_DIM
        )
        docs_to_embed = [user_docs[uid] for uid in missing_user_ids]
        new_embeddings = {}
        for i in tqdm(range(0, len(docs_to_embed), EMBEDDING_BATCH_SIZE), desc="Embedding missing user documents"):
            batch_ids = missing_user_ids[i:i+EMBEDDING_BATCH_SIZE]
            batch_docs = docs_to_embed[i:i+EMBEDDING_BATCH_SIZE]
            embeddings = gemini_service.embed_content(batch_docs)
            if embeddings:
                for user_id, emb in zip(batch_ids, embeddings):
                    new_embeddings[user_id] = emb
        user_embeddings.update(new_embeddings)
        with open(OUTPUT_EMBEDDINGS_PATH, 'wb') as f:
            pickle.dump(user_embeddings, f)
        print(f"Embeddings updated and saved to '{OUTPUT_EMBEDDINGS_PATH}'. Total embeddings: {len(user_embeddings)}")

    print("Calculating final similarity scores within each cluster...")
    final_similarity_scores = {}
    for cluster_id, user_ids_in_cluster in tqdm(clusters.items(), desc="Processing Clusters"):
        if len(user_ids_in_cluster) < 2: continue
        user_influencer_sims = {}
        for user_id in user_ids_in_cluster:
            user_idx = user_map[user_id]
            rating_sims = [calculate_pearson_sim(rating_matrix[user_idx], rating_matrix[inf_idx]) for inf_idx in influencer_indices]
            user_emb = user_embeddings.get(user_id)
            if user_emb is None:
                review_sims = np.zeros(len(influencer_ids))
            else:
                influencer_embs = np.array([user_embeddings.get(inf_id, np.zeros(EMBEDDING_DIM)) for inf_id in influencer_ids])
                review_sims = cosine_similarity([user_emb], influencer_embs)[0]
            hybrid_sims = (np.array(rating_sims) + review_sims) / 2.0
            user_influencer_sims[user_id] = hybrid_sims
        cluster_user_list = list(user_influencer_sims.keys())
        if not cluster_user_list: continue
        influencer_vectors = np.array([user_influencer_sims[uid] for uid in cluster_user_list])
        final_sim_matrix = cosine_similarity(influencer_vectors)
        for i, user1_id in enumerate(cluster_user_list):
            sim_scores = final_sim_matrix[i]
            user_score_pairs = list(zip(cluster_user_list, sim_scores))
            user_score_pairs.sort(key=lambda x: x[1], reverse=True)
            final_similarity_scores[user1_id] = user_score_pairs

    with open(OUTPUT_SIMILARITY_PATH, 'wb') as f:
        pickle.dump(final_similarity_scores, f)
    print(f"\nSimilarity calculation complete. Results saved to '{OUTPUT_SIMILARITY_PATH}'")
    
    if final_similarity_scores:
        print("\n--- Sample Similarity Scores ---")
        sample_user = list(final_similarity_scores.keys())[0]
        print(f"Top 5 most similar users to '{sample_user}':")
        for user, score in final_similarity_scores[sample_user][:6]:
            if user != sample_user:
                print(f"  - User: {user}, Similarity: {score:.4f}")
    print("="*50)

if __name__ == "__main__":
    main()