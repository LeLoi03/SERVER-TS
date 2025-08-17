# import pickle
# import pandas as pd
# import numpy as np

# # --- CONFIGURATION ---
# BASELINE_PREDICTIONS_PATH = 'user_full_predictions.pkl'
# ADVANCED_PREDICTIONS_PATH = 'user_full_predictions_mutifactor.pkl'
# CLUSTERING_FILE_PATH = 'user_clustering_results.pkl'
# USER_TO_INSPECT = 'user_31'
# TOP_N = 50 # INCREASED to see more detail

# def load_prediction_data(path):
#     """Safely loads a pickle file."""
#     try:
#         with open(path, 'rb') as f:
#             return pickle.load(f)
#     except FileNotFoundError:
#         print(f"Error: Prediction file not found at '{path}'")
#         return None

# def main():
#     """Performs a deep dive comparison of the two models."""
#     print("="*60)
#     print("--- Model Prediction Deep Dive Inspector ---")
#     print("="*60)
    
#     print("Loading prediction files and original data...")
#     baseline_data = load_prediction_data(BASELINE_PREDICTIONS_PATH)
#     advanced_data = load_prediction_data(ADVANCED_PREDICTIONS_PATH)
#     clustering_data = load_prediction_data(CLUSTERING_FILE_PATH)

#     if not all([baseline_data, advanced_data, clustering_data]):
#         return

#     user_map = advanced_data['user_map']
#     item_map = advanced_data['item_map']
#     rev_item_map = {v: k for k, v in item_map.items()}
    
#     original_matrix = clustering_data['rating_matrix']
#     baseline_matrix = baseline_data['prediction_matrix']
#     advanced_matrix = advanced_data['prediction_matrix']

#     if USER_TO_INSPECT not in user_map:
#         print(f"Error: User '{USER_TO_INSPECT}' not found.")
#         return
        
#     user_idx = user_map[USER_TO_INSPECT]
#     original_ratings = original_matrix[user_idx]
#     baseline_predictions = baseline_matrix[user_idx]
#     advanced_predictions = advanced_matrix[user_idx]

#     missing_item_indices = np.where(original_ratings == 0)[0]
    
#     comparison_list = []
#     for item_idx in missing_item_indices:
#         conf_name = rev_item_map.get(item_idx, "Unknown")
#         baseline_score = baseline_predictions[item_idx]
#         advanced_score = advanced_predictions[item_idx]
#         # Add the difference to see the impact
#         score_diff = advanced_score - baseline_score
#         comparison_list.append({
#             "Conference": conf_name,
#             "Baseline Score": baseline_score,
#             "Advanced Score": advanced_score,
#             "Score Change": score_diff
#         })
        
#     comparison_df = pd.DataFrame(comparison_list)
    
#     print(f"\n--- Analysis for User: '{USER_TO_INSPECT}' ---")

#     # --- NEW: Show items MOST PROMOTED by the Advanced Model ---
#     promoted_df = comparison_df.sort_values(by="Score Change", ascending=False).head(15)
#     print(f"\nTop 15 Conferences MOST PROMOTED by the Advanced (Mutifactor) Model:")
#     print("(These items gained the most score compared to the baseline)")
#     print(promoted_df.to_markdown(index=False))

#     # --- NEW: Show items MOST DEMOTED by the Advanced Model ---
#     demoted_df = comparison_df.sort_values(by="Score Change", ascending=True).head(15)
#     print(f"\nTop 15 Conferences MOST DEMOTED by the Advanced (Mutifactor) Model:")
#     print("(These items lost the most score compared to the baseline)")
#     print(demoted_df.to_markdown(index=False))

#     # --- MODIFIED: Show Top 50 to see more detail ---
#     top_advanced = comparison_df.sort_values(by="Advanced Score", ascending=False).head(TOP_N)
#     print(f"\nTop {TOP_N} Recommendations from the ADVANCED (Mutifactor) Model:")
#     print(top_advanced.to_markdown(index=False))
    
#     print("\n" + "="*60)

# if __name__ == "__main__":
#     main()


import pandas as pd
import numpy as np
import pickle
from tqdm import tqdm

# --- CONFIGURATION ---
CLUSTERING_FILE_PATH = 'user_clustering_results.pkl'
DATASET_FILE_PATH = 'conference_reviews_dataset.csv'

# --- User and Cluster to Inspect ---
# We'll pick one of the large clusters for a good sample size
CLUSTER_ID_TO_INSPECT = 9
# Pick a user from that cluster. We can find one after loading.
USER_TO_INSPECT = None # Will be set automatically
TOP_N = 10

# --- The two similarity functions we want to compare ---

def calculate_pearson_sim(u1_ratings, u2_ratings):
    """Calculates Pearson Correlation and normalizes to [0, 1]."""
    common_mask = (u1_ratings != 0) & (u2_ratings != 0)
    if np.sum(common_mask) < 2: return 0.0
    u1_common, u2_common = u1_ratings[common_mask], u2_ratings[common_mask]
    mean1, mean2 = u1_common.mean(), u2_common.mean()
    cov = np.sum((u1_common - mean1) * (u2_common - mean2))
    std1, std2 = np.sqrt(np.sum((u1_common - mean1)**2)), np.sqrt(np.sum((u2_common - mean2)**2))
    if std1 == 0 or std2 == 0: return 0.0
    pearson_sim = cov / (std1 * std2)
    return (np.nan_to_num(pearson_sim) + 1) / 2

def calculate_mutifactor_sim_full(u1_ratings, u2_ratings, u1_ts, u2_ts, alpha=0.01):
    """Calculates the full, multi-component similarity score."""
    rated1_mask, rated2_mask = u1_ratings != 0, u2_ratings != 0
    common_mask = rated1_mask & rated2_mask
    cuv = np.sum(common_mask)
    suv = np.sum(rated1_mask & ~rated2_mask) + np.sum(~rated1_mask & rated2_mask)
    u1_common_ratings, u2_common_ratings = u1_ratings[common_mask], u2_ratings[common_mask]
    agree_positive = (u1_common_ratings > 3) & (u2_common_ratings > 3)
    agree_negative = (u1_common_ratings < 3) & (u2_common_ratings < 3)
    duv = np.sum(agree_positive) + np.sum(agree_negative)
    u1_common_ts, u2_common_ts = u1_ts[common_mask], u2_ts[common_mask]
    time_diff_days = np.abs(u1_common_ts - u2_common_ts) / (60 * 60 * 24)
    tuv = np.sum(np.exp(-alpha * time_diff_days))
    term_c = 1 / cuv if cuv > 0 else 0
    term_s = 1 / suv if suv > 0 else 0
    term_d = 1 / duv if duv > 0 else 0
    term_t = 1 / tuv if tuv > 0 else 0
    return 1 / (1 + term_c + term_s + term_d + term_t)

def create_rating_and_timestamp_matrices(df, user_map, item_map):
    """Creates user-item rating and timestamp matrices."""
    num_users, num_items = len(user_map), len(item_map)
    rating_matrix = np.zeros((num_users, num_items))
    timestamp_matrix = np.zeros((num_users, num_items))
    for _, row in df.iterrows():
        user_idx, item_idx = user_map.get(row['user_id']), item_map.get(row['conference_key'])
        if user_idx is not None and item_idx is not None:
            rating_matrix[user_idx, item_idx] = row['rating']
            timestamp_matrix[user_idx, item_idx] = row['timestamp']
    return rating_matrix, timestamp_matrix

def main():
    """Directly compares the neighbor rankings of Pearson vs. Mutifactor."""
    global USER_TO_INSPECT
    print("="*60)
    print("--- Direct Similarity Impact Inspector ---")
    print("="*60)
    
    print("Loading data and clustering results...")
    df = pd.read_csv(DATASET_FILE_PATH)
    with open(CLUSTERING_FILE_PATH, 'rb') as f:
        clustering_data = pickle.load(f)

    user_map = clustering_data['user_map']
    item_map = clustering_data['item_map']
    clusters = clustering_data['clusters']
    
    users_in_cluster = clusters.get(CLUSTER_ID_TO_INSPECT)
    if not users_in_cluster:
        print(f"Error: Cluster ID {CLUSTER_ID_TO_INSPECT} not found or is empty.")
        return
        
    # Automatically pick the first user in the cluster to inspect
    USER_TO_INSPECT = users_in_cluster[0]
    print(f"Analyzing neighbors for user '{USER_TO_INSPECT}' within Cluster {CLUSTER_ID_TO_INSPECT}...")

    print("Creating rating and timestamp matrices...")
    rating_matrix, timestamp_matrix = create_rating_and_timestamp_matrices(df, user_map, item_map)
    
    target_user_idx = user_map[USER_TO_INSPECT]
    
    pearson_scores = []
    mutifactor_scores = []

    print("Calculating direct similarity scores for all users in the cluster...")
    for other_user_id in tqdm(users_in_cluster):
        if other_user_id == USER_TO_INSPECT:
            continue
        
        other_user_idx = user_map[other_user_id]
        
        # Calculate Pearson
        p_score = calculate_pearson_sim(rating_matrix[target_user_idx], rating_matrix[other_user_idx])
        pearson_scores.append({"Neighbor": other_user_id, "Pearson Score": p_score})
        
        # Calculate Mutifactor
        m_score = calculate_mutifactor_sim_full(
            rating_matrix[target_user_idx], rating_matrix[other_user_idx],
            timestamp_matrix[target_user_idx], timestamp_matrix[other_user_idx]
        )
        mutifactor_scores.append({"Neighbor": other_user_id, "Mutifactor Score": m_score})

    # --- Create and display the comparison tables ---
    pearson_df = pd.DataFrame(pearson_scores).sort_values(by="Pearson Score", ascending=False).head(TOP_N)
    mutifactor_df = pd.DataFrame(mutifactor_scores).sort_values(by="Mutifactor Score", ascending=False).head(TOP_N)

    print(f"\n--- Top {TOP_N} Neighbors for '{USER_TO_INSPECT}' using PEARSON ---")
    print(pearson_df.to_markdown(index=False))
    
    print(f"\n--- Top {TOP_N} Neighbors for '{USER_TO_INSPECT}' using MUTIFACTOR ---")
    print(mutifactor_df.to_markdown(index=False))
    
    # --- Highlight the differences ---
    pearson_neighbors = set(pearson_df['Neighbor'])
    mutifactor_neighbors = set(mutifactor_df['Neighbor'])
    
    newly_promoted = mutifactor_neighbors - pearson_neighbors
    demoted = pearson_neighbors - mutifactor_neighbors
    
    print("\n--- Summary of Ranking Changes ---")
    if not newly_promoted and not demoted:
        print("The Top 10 neighbor lists are identical.")
    else:
        print(f"Mutifactor changed the ranking, promoting {len(newly_promoted)} new users into the Top {TOP_N}.")
        if newly_promoted:
            print("\nUsers PROMOTED into Top 10 by Mutifactor:")
            for user in sorted(list(newly_promoted)):
                print(f"  - {user}")
        if demoted:
            print("\nUsers DEMOTED out of Top 10 by Mutifactor:")
            for user in sorted(list(demoted)):
                print(f"  - {user}")
                
    print("\n" + "="*60)

if __name__ == "__main__":
    main()