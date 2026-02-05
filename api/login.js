import pkg from 'pg';
import bcrypt from 'bcrypt';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { nome, senha } = req.body;
  if(!nome || !senha) return res.status(400).json({ error: 'Preencha todos os campos' });

  try {
    const query = 'SELECT * FROM usuarios WHERE nome = $1';
    const result = await pool.query(query, [nome]);

    if(result.rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];
    const match = await bcrypt.compare(senha, user.senha);
    if(!match) return res.status(401).json({ error: 'Senha incorreta' });

    res.status(200).json({ message: 'Login efetuado com sucesso', nome: user.nome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
