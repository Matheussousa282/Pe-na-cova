import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_CUSTOM,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const result = await pool.query('SELECT * FROM clientes ORDER BY id DESC');
      return res.status(200).json(result.rows);
    }

    if (req.method === 'POST') {
      const { nome, telefone, endereco, observacoes } = req.body;
      const result = await pool.query(
        'INSERT INTO clientes (nome, telefone, endereco, observacoes) VALUES ($1, $2, $3, $4) RETURNING *',
        [nome, telefone, endereco, observacoes]
      );
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      const { id } = req.query;
      const { nome, telefone, endereco, observacoes } = req.body;
      const result = await pool.query(
        'UPDATE clientes SET nome=$1, telefone=$2, endereco=$3, observacoes=$4 WHERE id=$5 RETURNING *',
        [nome, telefone, endereco, observacoes, id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      const result = await pool.query('DELETE FROM clientes WHERE id=$1 RETURNING *', [id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
      return res.status(200).json({ message: "Cliente excluído com sucesso" });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({ error: 'Erro no servidor: ' + error.message });
  }
}
