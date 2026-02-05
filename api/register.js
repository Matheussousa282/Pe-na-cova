import { Pool } from "pg";
import bcrypt from "bcrypt";

// Conexão com o Neon (Vercel)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // necessário para Neon
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ error: "Preencha todos os campos" });
  }

  try {
    // Criptografa a senha
    const hash = await bcrypt.hash(senha, 10);

    // Insere no banco de dados
    const result = await pool.query(
      "INSERT INTO usuarios (nome, senha) VALUES ($1, $2) RETURNING id, nome",
      [usuario, hash]
    );

    return res.status(200).json({ message: "Usuário cadastrado com sucesso!", user: result.rows[0] });
  } catch (err) {
    console.error("Erro ao cadastrar usuário:", err);

    // Mensagem mais detalhada para debug no Vercel
    return res.status(500).json({ error: "Erro ao cadastrar usuário no banco de dados" });
  }
}
