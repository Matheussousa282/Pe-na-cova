// api/usuarios.js
import pkg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Função auxiliar para query
async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export default async function handler(req, res) {
  const { method, body } = req;

  try {
    // ----------------- CADASTRAR USUÁRIO -----------------
    if (method === "POST" && req.url.includes("register")) {
      const { nome, senha } = body;
      if (!nome || !senha) {
        return res.status(400).json({ error: "Nome e senha são obrigatórios" });
      }

      // Criptografar senha
      const salt = await bcrypt.genSalt(10);
      const senhaHash = await bcrypt.hash(senha, salt);

      const result = await query(
        "INSERT INTO usuarios (nome, senha) VALUES ($1, $2) RETURNING id, nome",
        [nome, senhaHash]
      );

      return res.status(201).json({ message: "Usuário cadastrado", user: result.rows[0] });
    }

    // ----------------- LOGIN -----------------
    if (method === "POST" && req.url.includes("login")) {
      const { nome, senha } = body;
      if (!nome || !senha) {
        return res.status(400).json({ error: "Nome e senha são obrigatórios" });
      }

      const result = await query("SELECT * FROM usuarios WHERE nome = $1", [nome]);

      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Usuário não encontrado" });
      }

      const usuario = result.rows[0];
      const senhaValida = await bcrypt.compare(senha, usuario.senha);

      if (!senhaValida) {
        return res.status(401).json({ error: "Senha incorreta" });
      }

      return res.status(200).json({ message: "Login bem-sucedido", user: { id: usuario.id, nome: usuario.nome } });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error("Erro na API de usuários:", err.message, err.stack);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
