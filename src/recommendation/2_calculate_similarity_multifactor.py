import pandas as pd
import numpy as np
import pickle
from tqdm import tqdm
from sklearn.metrics.pairwise import cosine_similarity
import os
from dotenv import load_dotenv

# --- LOAD ENVIRONMENT VARIABLES ---
load_dotenv()

# --- CONFIGURATION ---
CLUSTERING_FILE_PATH = 'user_clustering_results.pkl'
DATASET_FILE_PATH = 'conference_reviews_dataset.csv'
EMBEDDINGS_FILE_PATH = 'user_review_embeddings.pkl'
OUTPUT_SIMILARITY_PATH = 'user_similarity_scores_mutifactor.pkl' # New output file

# Gemini Configuration (remains the same)
GEMINI_ENV_PREFIX = "GEMINI_API_KEY_"
EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT"
EMBEDDING_DIM = 768

# Influencer Configuration
NUM_INFLUENCERS = 50

# --- NEW: Full Mutifactor Similarity Implementation ---
def calculate_mutifactor_sim_full(u1_ratings, u2_ratings, u1_ts, u2_ts, alpha=0.01):
    """
    Calculates the full, multi-component similarity score as described in the plan.
    Alpha is the decay rate per day for the temporal component.
    """
    # Identify rated items (where value is not 0)
    rated1_mask = u1_ratings != 0
    rated2_mask = u2_ratings != 0
    
    # --- Cuv: Common Items ---
    common_mask = rated1_mask & rated2_mask
    cuv = np.sum(common_mask)
    
    # --- Suv: Symmetric Difference ---
    only1_mask = rated1_mask & ~rated2_mask
    only2_mask = ~rated1_mask & rated2_mask
    suv = np.sum(only1_mask) + np.sum(only2_mask)
    
    # --- Duv: Agreement (both > 3 or both < 3) on common items ---
    u1_common_ratings = u1_ratings[common_mask]
    u2_common_ratings = u2_ratings[common_mask]
    agree_positive = (u1_common_ratings > 3) & (u2_common_ratings > 3)
    agree_negative = (u1_common_ratings < 3) & (u2_common_ratings < 3)
    duv = np.sum(agree_positive) + np.sum(agree_negative)
    
    # --- Tuv: Temporal Decay on common items ---
    u1_common_ts = u1_ts[common_mask]
    u2_common_ts = u2_ts[common_mask]
    time_diff_seconds = np.abs(u1_common_ts - u2_common_ts)
    time_diff_days = time_diff_seconds / (60 * 60 * 24) # Convert to days
    temporal_decay = np.exp(-alpha * time_diff_days)
    tuv = np.sum(temporal_decay)

    # --- Final Formula: 1 / (1 + 1/C + 1/S + 1/D + 1/T) ---
    # As per the plan: if a component is 0, its inverse term is 0.
    term_c = 1 / cuv if cuv > 0 else 0
    term_s = 1 / suv if suv > 0 else 0
    term_d = 1 / duv if duv > 0 else 0
    term_t = 1 / tuv if tuv > 0 else 0
        
    denominator = 1 + term_c + term_s + term_d + term_t
    
    return 1 / denominator

# --- NEW: Helper function to create both matrices ---
def create_rating_and_timestamp_matrices(df, user_map, item_map):
    """Creates user-item rating and timestamp matrices from the dataframe."""
    num_users = len(user_map)
    num_items = len(item_map)
    
    rating_matrix = np.zeros((num_users, num_items))
    timestamp_matrix = np.zeros((num_users, num_items))

    for _, row in df.iterrows():
        user_idx = user_map.get(row['user_id'])
        item_idx = item_map.get(row['conference_key'])
        if user_idx is not None and item_idx is not None:
            rating_matrix[user_idx, item_idx] = row['rating']
            timestamp_matrix[user_idx, item_idx] = row['timestamp']
            
    return rating_matrix, timestamp_matrix

def main():
    """Main function to run the similarity calculation process with the full mutifactor formula."""
    print("="*50)
    print("STEP 2: HYBRID SIMILARITY CALCULATION (with Full Mutifactor-Sim)")
    print("="*50)

    print("Loading data and clustering results...")
    df = pd.read_csv(DATASET_FILE_PATH)
    with open(CLUSTERING_FILE_PATH, 'rb') as f:
        clustering_results = pickle.load(f)

    clusters = clustering_results['clusters']
    user_map = clustering_results['user_map']
    item_map = clustering_results['item_map']

    # --- UPGRADE: Create both rating and timestamp matrices ---
    print("Creating rating and timestamp matrices from source data...")
    rating_matrix, timestamp_matrix = create_rating_and_timestamp_matrices(df, user_map, item_map)

    print(f"Defining top {NUM_INFLUENCERS} influencers based on activity...")
    user_activity = df['user_id'].value_counts()
    influencer_ids = user_activity.head(NUM_INFLUENCERS).index.tolist()
    influencer_indices = [user_map[uid] for uid in influencer_ids]

    print(f"Loading user embeddings from '{EMBEDDINGS_FILE_PATH}'...")
    if not os.path.exists(EMBEDDINGS_FILE_PATH):
        print("Error: Embeddings file not found. Please run the embedding generation step first.")
        return
    with open(EMBEDDINGS_FILE_PATH, 'rb') as f:
        user_embeddings = pickle.load(f)

    print("Calculating final similarity scores using full mutifactor formula...")
    final_similarity_scores = {}

    for cluster_id, user_ids_in_cluster in tqdm(clusters.items(), desc="Processing Clusters"):
        if len(user_ids_in_cluster) < 2:
            continue

        user_influencer_sims = {}
        for user_id in user_ids_in_cluster:
            user_idx = user_map[user_id]
            
            # --- UPGRADE: Call the new mutifactor function ---
            rating_sims = [
                calculate_mutifactor_sim_full(
                    rating_matrix[user_idx], rating_matrix[inf_idx],
                    timestamp_matrix[user_idx], timestamp_matrix[inf_idx]
                ) for inf_idx in influencer_indices
            ]
            
            user_emb = user_embeddings.get(user_id)
            review_sims = np.zeros(len(influencer_ids))
            if user_emb is not None:
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
        print("\n--- Sample Similarity Scores (Mutifactor) ---")
        sample_user = list(final_similarity_scores.keys())[0]
        print(f"Top 5 most similar users to '{sample_user}':")
        for user, score in final_similarity_scores[sample_user][:6]:
            if user != sample_user:
                print(f"  - User: {user}, Similarity: {score:.4f}")
    print("="*50)

if __name__ == "__main__":
    main()