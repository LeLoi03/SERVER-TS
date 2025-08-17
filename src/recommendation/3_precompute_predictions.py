import pandas as pd
import numpy as np
import pickle
from tqdm import tqdm

# --- CONFIGURATION ---
# Use these lines when running on the full dataset
CLUSTERING_FILE_PATH = 'user_clustering_results.pkl'
SIMILARITY_FILE_PATH = 'user_similarity_scores_mutifactor.pkl'
OUTPUT_PREDICTIONS_PATH = 'user_full_predictions_mutifactor.pkl'
sample_user_id = 'user_31' 

# # Use these lines for the Golden Dataset verification
# CLUSTERING_FILE_PATH = 'golden_dataset_clustering_results.pkl'
# SIMILARITY_FILE_PATH = 'golden_dataset_similarity_scores.pkl' # Or the mutifactor one
# OUTPUT_PREDICTIONS_PATH = 'golden_dataset_predictions.pkl'
# sample_user_id = 'u1'

# Number of nearest neighbors to consider for prediction
NUM_NEIGHBORS = 25

def predict_rating_for_user_item(target_user_idx, target_item_idx, rating_matrix, user_map, rev_user_map, similarity_scores, k):
    """
    Predicts a rating for a single user-item pair using user-based collaborative filtering.
    Returns None if a prediction cannot be made.
    """
    target_user_id = rev_user_map[target_user_idx]
    similar_users = similarity_scores.get(target_user_id, [])
    
    numerator = 0
    denominator = 0
    neighbors_found = 0
    
    for neighbor_id, sim_score in similar_users:
        if neighbors_found >= k or sim_score <= 0:
            break
        if neighbor_id == target_user_id:
            continue
            
        neighbor_idx = user_map.get(neighbor_id)
        if neighbor_idx is None:
            continue
            
        neighbor_rating = rating_matrix[neighbor_idx, target_item_idx]
        if neighbor_rating > 0:
            numerator += sim_score * neighbor_rating
            denominator += sim_score
            neighbors_found += 1
            
    if denominator == 0:
        return None
        
    predicted_rating = numerator / denominator
    return np.clip(predicted_rating, 1, 5)

def main():
    """Main function to pre-compute and save all missing ratings."""
    print("="*50)
    print("STEP 3: PRE-COMPUTING PREDICTIONS (Corrected)")
    print("="*50)

    print("Loading clustering results and similarity scores...")
    with open(CLUSTERING_FILE_PATH, 'rb') as f:
        clustering_results = pickle.load(f)
    with open(SIMILARITY_FILE_PATH, 'rb') as f:
        similarity_scores = pickle.load(f)

    rating_matrix = clustering_results['rating_matrix']
    user_map = clustering_results['user_map']
    rev_user_map = clustering_results['rev_user_map']
    
    num_users, num_items = rating_matrix.shape
    print(f"Loaded data for {num_users} users and {num_items} conferences.")

    full_prediction_matrix = np.copy(rating_matrix)
    
    print(f"Starting prediction for all missing ratings using k={NUM_NEIGHBORS} neighbors...")
    
    print("Pre-calculating user average ratings for fallback...")
    user_means = np.true_divide(rating_matrix.sum(1), (rating_matrix != 0).sum(1))
    global_mean = np.mean(rating_matrix[rating_matrix > 0])
    user_means[np.isnan(user_means)] = global_mean

    for user_idx in tqdm(range(num_users), desc="Processing Users"):
        for item_idx in range(num_items):
            if rating_matrix[user_idx, item_idx] == 0:
                predicted_rating = predict_rating_for_user_item(
                    user_idx, 
                    item_idx, 
                    rating_matrix, 
                    user_map, 
                    rev_user_map, 
                    similarity_scores, 
                    k=NUM_NEIGHBORS
                )
                
                if predicted_rating is not None:
                    full_prediction_matrix[user_idx, item_idx] = predicted_rating
                else:
                    full_prediction_matrix[user_idx, item_idx] = user_means[user_idx]

    full_prediction_matrix = np.clip(full_prediction_matrix, 1, 5)

    prediction_data = {
        "prediction_matrix": full_prediction_matrix,
        "user_map": user_map,
        "item_map": clustering_results['item_map']
    }
    
    with open(OUTPUT_PREDICTIONS_PATH, 'wb') as f:
        pickle.dump(prediction_data, f)
        
    print(f"\nPrediction complete. Full prediction data saved to '{OUTPUT_PREDICTIONS_PATH}'")
    
    # --- FIX: Make the Verification Step Dynamic ---
    print("\n--- Verification ---")
    if sample_user_id in user_map:
        sample_user_idx = user_map[sample_user_id]
        
        # Find the first item index that the user has NOT rated
        original_user_ratings = rating_matrix[sample_user_idx]
        missing_indices = np.where(original_user_ratings == 0)[0]
        
        if len(missing_indices) > 0:
            item_to_check_idx = missing_indices[0]
            
            # Get the item's actual name for a more readable printout
            rev_item_map = {v: k for k, v in clustering_results['item_map'].items()}
            item_name = rev_item_map.get(item_to_check_idx, f"Item Index {item_to_check_idx}")

            original_rating = rating_matrix[sample_user_idx, item_to_check_idx]
            predicted_rating = full_prediction_matrix[sample_user_idx, item_to_check_idx]
            
            print(f"For user '{sample_user_id}':")
            print(f"  - Original rating for a missing item ('{item_name}'): {original_rating}")
            print(f"  - Predicted rating for that item: {predicted_rating:.4f}")
            print("This confirms that NULL values have been filled.")
        else:
            print(f"Verification skipped: User '{sample_user_id}' has rated all items.")
    else:
        print(f"Verification skipped: Sample user '{sample_user_id}' not found in dataset.")
    
    print("="*50)

if __name__ == "__main__":
    main()