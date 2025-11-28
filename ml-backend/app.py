import os
import pickle
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from tensorflow.keras import layers, Model
from tensorflow.keras import backend as K
from tensorflow.keras.regularizers import l2
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Variables globales para el modelo y datos
model = None
scaler = None
tfidf = None
svd = None
label_encoders = None
embeddings_all = None
ids = None
names = None
numeric_cols = None
cat_cols = None
song_mapping = {}

def load_model():
    global model, scaler, tfidf, svd, label_encoders, embeddings_all, ids, names, numeric_cols, cat_cols
    
    pkl_path = os.path.join(os.path.dirname(__file__), "..", "models", "recommender.pkl")
    
    logger.info(f"Loading model from: {pkl_path}")
    
    with open(pkl_path, "rb") as f:
        data = pickle.load(f)
    
    # Cargar configuración
    model_config = data["model_config"]
    model_weights = data["model_weights"]
    
    scaler = data["scaler"]
    tfidf = data["tfidf"]
    svd = data["svd"]
    label_encoders = data["label_encoders"]
    
    ids = data["ids"]
    names = data["names"]
    embeddings_all = data["embeddings"]
    
    numeric_cols = data["numeric_cols"]
    cat_cols = data["categorical_cols"]
    
    # Reconstruir el modelo (DEBE coincidir EXACTAMENTE con la arquitectura entrenada)
    numeric_dim = model_config["numeric_dim"]
    text_dim = model_config["text_dim"]
    cat_cols_config = model_config["categorical_cols"]
    cat_cards = model_config["cat_cardinalities"]
    embedding_dim = model_config["embedding_dim"]
    
    ARTIST_WEIGHT = 16.0
    DROPOUT_RATE = 0.4
    L2_REG = 3e-4
    
    # Entradas
    numeric_in = layers.Input(shape=(numeric_dim,), name="numeric_input")
    text_in = layers.Input(shape=(text_dim,), name="text_input")
    
    # Ruido gaussiano ligero (sólo en entrenamiento) para robustez
    num_feat = layers.GaussianNoise(0.01, name="numeric_noise")(numeric_in)
    text_feat = layers.GaussianNoise(0.01, name="text_noise")(text_in)
    
    # Categóricas
    cat_inputs = {}
    cat_embs = []
    artist_emb_index = None
    
    for i, col in enumerate(cat_cols_config):
        inp = layers.Input(shape=(1,), dtype="int32", name=f"{col}_input")
        cat_inputs[col] = inp
        
        vocab = int(cat_cards[col]) + 1
        emb_dim = min(50, max(4, int(1 + np.log2(max(2, cat_cards[col])) * 4)))
        
        emb = layers.Embedding(
            input_dim=vocab,
            output_dim=emb_dim,
            embeddings_regularizer=l2(L2_REG),
            name=f"{col}_emb"
        )(inp)
        emb = layers.Flatten()(emb)
        emb = layers.Dropout(0.25, name=f"{col}_emb_dropout")(emb)
        emb = layers.GaussianNoise(0.01, name=f"{col}_emb_noise")(emb)
        
        cat_embs.append(emb)
        
        if col == "artists":
            artist_emb_index = i
    
    # Concatenación de todas las características
    concat = layers.Concatenate(name="concat_features")(
        [num_feat, text_feat] + cat_embs
    )
    
    # Tronco compartido regularizado con conexión residual
    x = layers.Dense(512, activation="relu", kernel_regularizer=l2(L2_REG), name="dense_1")(concat)
    x = layers.BatchNormalization(name="batch_norm_1")(x)
    x = layers.Dropout(DROPOUT_RATE, name="dropout_1")(x)
    
    x = layers.Dense(256, activation="relu", kernel_regularizer=l2(L2_REG), name="dense_2")(x)
    x = layers.BatchNormalization(name="batch_norm_2")(x)
    x = layers.Dropout(DROPOUT_RATE, name="dropout_2")(x)
    
    x = layers.Dense(128, activation="relu", kernel_regularizer=l2(L2_REG), name="dense_3")(x)
    x = layers.BatchNormalization(name="batch_norm_3")(x)
    
    # Proyección residual desde la entrada concatenada
    res = layers.Dense(128, activation="linear", kernel_regularizer=l2(L2_REG), name="res_proj")(concat)
    x = layers.Add(name="residual_add")([x, res])
    x = layers.Dropout(DROPOUT_RATE/2, name="final_dropout")(x)
    
    # Embedding (se mantiene la interfaz y normalización L2)
    embedding_raw = layers.Dense(
        embedding_dim,
        activation="linear",
        kernel_regularizer=l2(L2_REG),
        name="embedding_raw"
    )(x)
    
    artist_emb = cat_embs[artist_emb_index]
    artist_strength = layers.Dense(
        embedding_dim,
        activation="linear",
        kernel_regularizer=l2(L2_REG),
        name="artist_strength"
    )(artist_emb)
    artist_strength = layers.Lambda(lambda t: t * ARTIST_WEIGHT, name="artist_boost")(artist_strength)
    embedding_raw = layers.Add(name="add_artist_boost")([embedding_raw, artist_strength])
    
    embedding = layers.Lambda(lambda t: K.l2_normalize(t, axis=1), name="embedding")(embedding_raw)
    
    # NUEVA CABEZA DE TENDENCIA - Para rango 0.2-0.9 en lugar de extremos
    # Reducir capas y usar activación diferente para evitar saturación
    trend_head = layers.Dense(64, activation="relu", kernel_regularizer=l2(L2_REG), name="trend_dense_1")(x)
    trend_head = layers.Dropout(0.2, name="trend_dropout_1")(trend_head)  # Menos dropout
    trend_head = layers.Dense(32, activation="relu", kernel_regularizer=l2(L2_REG), name="trend_dense_2")(trend_head)
    trend_head = layers.Dropout(0.1, name="trend_dropout_2")(trend_head)  # Menos dropout

    # Salida lineal + transformación custom para rango [0.2, 0.9]
    trend_logit = layers.Dense(1, activation="linear", kernel_regularizer=l2(L2_REG), name="trend_logit")(trend_head)

    # Mapeo de logit a rango [0.2, 0.9] usando tanh + escalado
    def map_to_range_02_09(x):
        # tanh da rango [-1, 1], escalamos a [0.2, 0.9]
        tanh_out = K.tanh(x * 0.5)  # Factor 0.5 para suavizar
        return 0.55 + 0.35 * tanh_out  # Mapeo: centro=0.55, rango=±0.35

    trend_output = layers.Lambda(map_to_range_02_09, name="trend_output")(trend_logit)
    
    model = Model(
        inputs=[numeric_in, text_in] + list(cat_inputs.values()),
        outputs=[embedding, trend_output]
    )
    
    model.set_weights(model_weights)
    
    logger.info("Model loaded successfully.")

def clean_artist_field(x):
    s = str(x)
    if s.startswith("[") and s.endswith("]"):
        s2 = s.strip()[1:-1].strip()
        s2 = s2.replace("'", "").replace('"', '')
        first = s2.split(",")[0].strip()
        return first
    return s

def create_song_mapping():
    global song_mapping
    import pandas as pd
    
    csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "dataset_processed.csv")
    logger.info(f"Loading dataset from: {csv_path}")
    
    # Cargar solo las columnas necesarias
    df = pd.read_csv(csv_path, usecols=['id', 'name', 'artists'])
    
    # Aplicar la misma limpieza que en el notebook
    df['artists'] = df['artists'].apply(clean_artist_field)
    
    for idx, row in df.iterrows():
        song_id = row['id']
        song_mapping[song_id] = {
            'name': row['name'],
            'artist': row['artists'],  # Ya está limpio
            'index': idx
        }
    
    logger.info(f"Mapping created: {len(song_mapping)} songs loaded.")

def find_song_in_dataset(song_title, song_artist):
    # Normalizar strings para comparación
    song_title_norm = song_title.lower().strip()
    song_artist_norm = song_artist.lower().strip()
    
    best_match = None
    best_score = 0
    
    for song_id, info in song_mapping.items():
        name_norm = info['name'].lower().strip()
        artist_norm = str(info['artist']).lower().strip()
        
        # Coincidencia exacta
        if name_norm == song_title_norm and artist_norm == song_artist_norm:
            return song_id
        
        # Coincidencia parcial (título contiene o está contenido)
        title_match = song_title_norm in name_norm or name_norm in song_title_norm
        artist_match = song_artist_norm in artist_norm or artist_norm in song_artist_norm
        
        if title_match and artist_match:
            score = len(set(name_norm.split()) & set(song_title_norm.split()))
            if score > best_score:
                best_score = score
                best_match = song_id
    
    return best_match

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model_loaded': model is not None})

@app.route('/predict-trending', methods=['POST'])
def predict_trending():

    try:
        data = request.json
        song_title = data.get('title')
        song_artist = data.get('artist')
        
        if not song_title or not song_artist:
            return jsonify({'error': 'title and artist are required'}), 400
        
        # Buscar la canción en el dataset
        song_id = find_song_in_dataset(song_title, song_artist)
        
        if not song_id:
            logger.warning(f"Canción no encontrada: {song_title} - {song_artist}")
            return jsonify({
                'error': 'Song not found in dataset',
                'title': song_title,
                'artist': song_artist,
                'probability': 0.5  # Valor por defecto
            }), 404
        
        # Obtener el índice en el dataset
        idx = ids.index(song_id)
        
        # Cargar el dataset completo para obtener las features
        import pandas as pd
        csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "dataset_processed.csv")
        
        # Cargar solo la fila necesaria (más eficiente)
        df = pd.read_csv(csv_path, skiprows=range(1, idx+1), nrows=1)
        
        # Construir input
        row = df.iloc[0]
        
        # Numeric features
        num = scaler.transform([row[numeric_cols].values])[0]
        
        # Text features
        text = svd.transform(tfidf.transform([str(row['tokens'])]))[0]
        
        inputs = {
            "numeric_input": np.array([num]),
            "text_input": np.array([text])
        }
        
        # Categorical features - manejar valores no vistos
        for col in cat_cols:
            value = str(row[col])
            
            # Limpiar el campo artists igual que en el notebook
            if col == "artists":
                value = clean_artist_field(value)
            
            encoder = label_encoders[col]
            
            # Verificar si el valor fue visto durante el entrenamiento
            if value in encoder.classes_:
                encoded = encoder.transform([value])
            else:
                # Usar valor por defecto (0 = desconocido)
                logger.warning(f"Valor no visto en '{col}': {value}. Usando valor por defecto.")
                encoded = np.array([0])
            
            inputs[f"{col}_input"] = np.array(encoded).reshape(1, 1)
        
        _, pred_trending = model.predict(inputs, verbose=0)
        probability = float(pred_trending[0][0])
        
        logger.info(f"PREDICT: {song_title} by {song_artist} -> Probability: {probability:.4f} (rango 0.2-0.9)")
        
        return jsonify({
            'title': song_title,
            'artist': song_artist,
            'probability': probability,
            'dataset_id': song_id
        })
        
    except Exception as e:
        logger.error(f"Error en predict_trending: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/recommend', methods=['POST'])
def recommend():
    try:
        data = request.json
        song_title = data.get('title')
        song_artist = data.get('artist')
        k = data.get('k', 10)
        
        if not song_title or not song_artist:
            return jsonify({'error': 'title and artist are required'}), 400
        
        logger.info(f"RECOMMEND: Query {song_title} by {song_artist} k={k}")
        
        song_id = find_song_in_dataset(song_title, song_artist)
        
        if not song_id:
            logger.warning(f"Song not found for recommendation: {song_title} - {song_artist}")
            return jsonify({
                'error': 'Song not found in dataset',
                'recommendations': []
            }), 404
        
        if song_id not in ids:
            return jsonify({'error': 'Song ID not in embeddings'}), 404
        
        # Obtener embedding de la canción
        idx = ids.index(song_id)
        vec = embeddings_all[idx].reshape(1, -1)
        
        # Calcular similitudes
        from scipy.spatial.distance import cdist
        dists = cdist(vec, embeddings_all, metric="cosine")[0]
        sims = 1 - dists
        
        # Excluir la canción actual
        sims[idx] = -999
        
        # Top K similares
        top = sims.argsort()[::-1][:k]
        
        recommendations = []
        for i in top:
            recommendations.append({
                'dataset_id': ids[i],
                'name': names[i],
                'similarity': float(sims[i])
            })
        
        logger.info(f"RECOMMEND: Found {len(recommendations)} similar songs for '{song_title}' by {song_artist}")
        for idx, rec in enumerate(recommendations, 1):
            logger.info(f"  {idx}. {rec['name']} | similarity: {rec['similarity']:.4f} | dataset_id: {rec['dataset_id']}")
        
        return jsonify({
            'query': {
                'title': song_title,
                'artist': song_artist,
                'dataset_id': song_id
            },
            'recommendations': recommendations
        })
        
    except Exception as e:
        logger.error(f"Error en recommend: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    logger.info("Iniciando ML Backend...")
    load_model()
    create_song_mapping()
    app.run(host='0.0.0.0', port=5001, debug=True)
