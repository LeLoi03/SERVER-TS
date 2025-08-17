import pickle

# --- CONFIGURATION ---
CLUSTERING_FILE_PATH = 'golden_dataset_clustering_results.pkl'

def main():
    """Loads the clustering results and prints the contents."""
    print("--- Inspecting Cluster Contents ---")
    
    try:
        with open(CLUSTERING_FILE_PATH, 'rb') as f:
            results = pickle.load(f)
    except FileNotFoundError:
        print(f"Error: File not found at '{CLUSTERING_FILE_PATH}'")
        return
        
    clusters = results.get('clusters')
    
    if not clusters:
        print("Could not find 'clusters' dictionary in the file.")
        return
        
    for cluster_id, user_list in clusters.items():
        print(f"\nCluster ID: {cluster_id}")
        print(f"Number of Users: {len(user_list)}")
        print(f"Users: {sorted(user_list)}") # Sorting makes it easier to compare

if __name__ == "__main__":
    main()