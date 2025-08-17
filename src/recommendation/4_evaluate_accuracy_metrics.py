import pandas as pd
import numpy as np
import pickle
from tqdm import tqdm
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error

# --- CONFIGURATION ---
DATASET_FILE_PATH = 'conference_reviews_dataset.csv'
TEST_SET_SIZE = 0.2
NUM_NEIGHBORS = 25

# --- Similarity Functions (Copied from previous scripts for a self-contained experiment) ---
def calculate_pearson_sim(u1_ratings, u2_ratings):
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

# --- Prediction Function (Adapted for this experiment) ---
def predict_rating(target_user_idx, target_item_idx, rating_matrix, similarity_matrix, user_map, k):
    """Predicts a rating using a pre-computed similarity matrix."""
    # Get similarity scores for the target user
    user_similarities = similarity_matrix[target_user_idx]
    
    # Find top k neighbors who have rated the item
    neighbors = []
    # argsort returns indices that would sort the array. We reverse it for descending order.
    for neighbor_idx in np.argsort(user_similarities)[::-1]:
        if len(neighbors) >= k:
            break
        if neighbor_idx == target_user_idx:
            continue
        
        neighbor_rating = rating_matrix[neighbor_idx, target_item_idx]
        if neighbor_rating > 0:
            neighbors.append((user_similarities[neighbor_idx], neighbor_rating))

    if not neighbors:
        return None # Cannot predict

    numerator = sum(sim * rating for sim, rating in neighbors)
    denominator = sum(sim for sim, _ in neighbors)
    
    return numerator / denominator if denominator > 0 else None

# --- Main Evaluation Workflow ---
def run_evaluation(df, sim_function, use_timestamps=False):
    """Runs the full train-test evaluation for a given similarity function."""
    # 1. Split data
    train_df, test_df = train_test_split(df, test_size=TEST_SET_SIZE, random_state=42)
    
    # 2. Build matrices from TRAINING data ONLY
    all_users = df['user_id'].unique()
    all_items = df['conference_key'].unique()
    user_map = {uid: i for i, uid in enumerate(all_users)}
    item_map = {iid: i for i, iid in enumerate(all_items)}
    
    rating_matrix = np.zeros((len(all_users), len(all_items)))
    timestamp_matrix = np.zeros((len(all_users), len(all_items))) if use_timestamps else None

    for _, row in train_df.iterrows():
        uidx, iidx = user_map.get(row['user_id']), item_map.get(row['conference_key'])
        if uidx is not None and iidx is not None:
            rating_matrix[uidx, iidx] = row['rating']
            if use_timestamps:
                timestamp_matrix[uidx, iidx] = row['timestamp']

    # 3. Calculate the full user-user similarity matrix
    num_users = len(all_users)
    similarity_matrix = np.zeros((num_users, num_users))
    
    pbar_desc = "Calculating " + ("Mutifactor" if use_timestamps else "Pearson") + " Similarities"
    for i in tqdm(range(num_users), desc=pbar_desc):
        for j in range(i, num_users):
            if i == j:
                similarity_matrix[i, j] = 1.0
            else:
                if use_timestamps:
                    sim = sim_function(rating_matrix[i], rating_matrix[j], timestamp_matrix[i], timestamp_matrix[j])
                else:
                    sim = sim_function(rating_matrix[i], rating_matrix[j])
                similarity_matrix[i, j] = similarity_matrix[j, i] = sim

    # 4. Generate predictions for the TEST set
    predictions = []
    actuals = []
    user_means = np.true_divide(rating_matrix.sum(1), (rating_matrix != 0).sum(1))
    global_mean = np.mean(rating_matrix[rating_matrix > 0])
    user_means[np.isnan(user_means)] = global_mean

    for _, row in tqdm(test_df.iterrows(), total=len(test_df), desc="Generating Predictions"):
        uidx, iidx = user_map.get(row['user_id']), item_map.get(row['conference_key'])
        
        if uidx is None or iidx is None:
            continue # Skip users/items not seen in training set
            
        pred = predict_rating(uidx, iidx, rating_matrix, similarity_matrix, user_map, k=NUM_NEIGHBORS)
        
        # Use user's average as fallback
        if pred is None:
            pred = user_means[uidx]
            
        predictions.append(pred)
        actuals.append(row['rating'])
        
    return predictions, actuals

def main():
    """Main function to run and compare model evaluations."""
    print("="*60)
    print("--- Academic Metrics Evaluation (RMSE & MAE) ---")
    print("="*60)
    
    df = pd.read_csv(DATASET_FILE_PATH)
    
    # --- Evaluate Baseline (Pearson) Model ---
    print("\n--- Evaluating Baseline Model (Pearson Similarity) ---")
    pearson_preds, pearson_actuals = run_evaluation(df, calculate_pearson_sim, use_timestamps=False)
    
    # --- Evaluate Advanced (Mutifactor) Model ---
    print("\n--- Evaluating Advanced Model (Mutifactor Similarity) ---")
    mutifactor_preds, mutifactor_actuals = run_evaluation(df, calculate_mutifactor_sim_full, use_timestamps=True)
    
    # --- Calculate and Display Results ---
    print("\n" + "="*60)
    print("--- Final Accuracy Results ---")
    print("="*60)
    
    results = {
        "Model": ["Baseline (Pearson)", "Advanced (Mutifactor)"],
        "RMSE": [
            np.sqrt(mean_squared_error(pearson_actuals, pearson_preds)),
            np.sqrt(mean_squared_error(mutifactor_actuals, mutifactor_preds))
        ],
        "MAE": [
            mean_absolute_error(pearson_actuals, pearson_preds),
            mean_absolute_error(mutifactor_actuals, mutifactor_preds)
        ]
    }
    
    results_df = pd.DataFrame(results)
    print(results_df.to_markdown(index=False))
    
    # --- Conclusion ---
    print("\n--- Conclusion ---")
    rmse_baseline = results["RMSE"][0]
    rmse_advanced = results["RMSE"][1]
    
    if rmse_advanced < rmse_baseline:
        improvement = (rmse_baseline - rmse_advanced) / rmse_baseline * 100
        print(f"✅ The Advanced (Mutifactor) model is MORE ACCURATE.")
        print(f"   It shows a {improvement:.2f}% improvement in RMSE over the baseline.")
    elif rmse_advanced > rmse_baseline:
        decline = (rmse_advanced - rmse_baseline) / rmse_baseline * 100
        print(f"⚠️ The Advanced (Mutifactor) model is LESS ACCURATE.")
        print(f"   It shows a {decline:.2f}% decline in RMSE compared to the baseline.")
    else:
        print("↔️ Both models have identical predictive accuracy.")
        
    print("\nLower RMSE and MAE values are better.")
    print("="*60)

if __name__ == "__main__":
    main()