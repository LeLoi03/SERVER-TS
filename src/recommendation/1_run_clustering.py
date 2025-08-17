import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
import pickle

# --- CONFIGURATION ---
# DATASET_FILE_PATH = 'conference_reviews_dataset.csv'
# NUM_CLUSTERS = 10  # Let's use a more realistic number of clusters, e.g., 10
# OUTPUT_CLUSTERING_PATH = 'user_clustering_results.pkl'


DATASET_FILE_PATH = 'golden_dataset.csv'
NUM_CLUSTERS = 2
OUTPUT_CLUSTERING_PATH = 'golden_dataset_clustering_results.pkl'

def create_rating_matrix(df):
    """Creates a user-item rating matrix from the dataframe."""
    users = df['user_id'].unique()
    items = df['conference_key'].unique()
    
    user_map = {uid: i for i, uid in enumerate(users)}
    item_map = {iid: i for i, iid in enumerate(items)}
    
    # Create reverse maps to get original IDs back later
    rev_user_map = {i: uid for uid, i in user_map.items()}
    rev_item_map = {i: iid for iid, i in item_map.items()}

    rating_matrix = np.zeros((len(users), len(items)))
    for _, row in df.iterrows():
        user_idx = user_map[row['user_id']]
        item_idx = item_map[row['conference_key']]
        rating_matrix[user_idx, item_idx] = row['rating']
        
    return rating_matrix, user_map, item_map, rev_user_map, rev_item_map

def select_icr_centroids(rating_matrix, num_clusters):
    """Selects initial centroids based on the highest rating counts (ICR)."""
    num_ratings_per_user = np.sum(rating_matrix != 0, axis=1)
    # Get the indices of the top-k users
    centroid_indices = np.argsort(num_ratings_per_user)[-num_clusters:]
    return centroid_indices

def apply_kmeans_with_icr(rating_matrix, num_clusters):
    """Applies K-Means clustering with ICR-selected initial centroids."""
    print("Selecting initial centroids using ICR method...")
    initial_centroid_indices = select_icr_centroids(rating_matrix, num_clusters)
    initial_centroids = rating_matrix[initial_centroid_indices]
    
    print("Filling missing values with user-mean for clustering...")
    # Fill missing values (0s) with the user's mean rating for clustering purposes
    # This is often more stable than item-mean
    user_means = np.true_divide(rating_matrix.sum(1), (rating_matrix!=0).sum(1))
    user_means[np.isnan(user_means)] = 0 # Handle users with no ratings (shouldn't happen)
    filled_matrix = np.where(rating_matrix == 0, user_means[:, np.newaxis], rating_matrix)

    print(f"Running K-Means with {num_clusters} clusters...")
    kmeans = KMeans(n_clusters=num_clusters, init=initial_centroids, n_init=1, random_state=42)
    labels = kmeans.fit_predict(filled_matrix)
    
    return labels

def main():
    """Main function to run the clustering process."""
    print("="*50)
    print("STEP 1: USER CLUSTERING")
    print("="*50)

    # --- 1. Load Data ---
    try:
        df = pd.read_csv(DATASET_FILE_PATH)
    except FileNotFoundError:
        print(f"Error: Dataset file '{DATASET_FILE_PATH}' not found.")
        return

    print(f"Loaded {len(df)} reviews.")

    # --- 2. Create Rating Matrix ---
    print("Creating user-item rating matrix...")
    rating_matrix, user_map, item_map, rev_user_map, rev_item_map = create_rating_matrix(df)
    print(f"Matrix created with shape: {rating_matrix.shape} (Users x Conferences)")

    # --- 3. Apply Clustering ---
    labels = apply_kmeans_with_icr(rating_matrix, NUM_CLUSTERS)
    
    # --- 4. Process and Save Results ---
    print("Processing and saving clustering results...")
    
    # Create a dictionary to store which users are in which cluster
    clusters = {i: [] for i in range(NUM_CLUSTERS)}
    for user_idx, cluster_label in enumerate(labels):
        original_user_id = rev_user_map[user_idx]
        clusters[cluster_label].append(original_user_id)

    # Save all necessary objects for the next steps
    clustering_results = {
        "clusters": clusters,
        "labels": labels, # labels array, indexed by user_map
        "user_map": user_map,
        "item_map": item_map,
        "rev_user_map": rev_user_map,
        "rev_item_map": rev_item_map,
        "rating_matrix": rating_matrix # We'll need this for similarity calculation
    }
    
    with open(OUTPUT_CLUSTERING_PATH, 'wb') as f:
        pickle.dump(clustering_results, f)

    print(f"\nClustering complete. Results saved to '{OUTPUT_CLUSTERING_PATH}'")
    
    # --- 5. Display Cluster Stats ---
    print("\n--- Clustering Statistics ---")
    cluster_stats = pd.DataFrame({
        "Cluster ID": list(clusters.keys()),
        "Number of Users": [len(users) for users in clusters.values()]
    }).sort_values(by="Number of Users", ascending=False)
    
    print(cluster_stats.to_markdown(index=False))
    print("="*50)

if __name__ == "__main__":
    main()