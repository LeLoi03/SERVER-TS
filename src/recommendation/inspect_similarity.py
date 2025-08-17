import pickle

# --- CONFIGURATION ---
SIMILARITY_FILE_PATH = 'golden_dataset_similarity_scores.pkl'

def main():
    """Loads the similarity score results and prints them for verification."""
    print("--- Inspecting Similarity Score Contents ---")
    
    try:
        with open(SIMILARITY_FILE_PATH, 'rb') as f:
            similarity_scores = pickle.load(f)
    except FileNotFoundError:
        print(f"Error: File not found at '{SIMILARITY_FILE_PATH}'")
        return
        
    if not isinstance(similarity_scores, dict):
        print("Error: The loaded data is not a dictionary.")
        return
        
    # Sort the user IDs to ensure a consistent output order
    sorted_user_ids = sorted(similarity_scores.keys())
    
    for user_id in sorted_user_ids:
        scores = similarity_scores[user_id]
        
        print(f"\n--- Similarities for User: {user_id} ---")
        
        if not scores:
            print("  No similarity scores found.")
            continue
            
        # Print a formatted table-like output
        print(f"{'Rank':<5} {'Similar User':<15} {'Similarity Score':<20}")
        print("-" * 45)
        
        for i, (similar_user, score) in enumerate(scores):
            # We don't need to see the user's similarity to themselves (which is always 1.0)
            if similar_user == user_id:
                continue
            
            rank = i + 1
            print(f"{rank:<5} {similar_user:<15} {score:<20.4f}")

if __name__ == "__main__":
    main()