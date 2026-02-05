import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Função auxiliar
async function query(sql, params = []) {
  return pool.query(sql, params);
}

export default async function handler(req, res) {
  const { method, body, query: queryParams } = req;

  try {

    // -------- GET --------
    if (method === "GET") {
      const result = await query(`
        SELECT 
          c.id, 
          COALESCE(cl.nome, 'Cliente não encontrado') AS cliente, 
          c.valor, 
          c.status, 
          to_char(c.data, 'DD/MM/YYYY') AS data
        FROM contasareceber c
        LEFT JOIN clientes cl ON c.cliente_id = cl.id
        ORDER BY c.id DESC
      `);
      return res.status(200).json(result.rows);
    }

    // -------- POST --------
    if (method === "POST") {
      const { cliente_id, valor, status } = body;

      if (!cliente_id || valor == null) {
        return res.status(400).json({ error: "Cliente e valor são obrigatórios" });
      }

      const result = await query(
        `INSERT INTO contasareceber (cliente_id, valor, status, data)
         VALUES ($1,$2,$3,NOW()) RETURNING *`,
        [cliente_id, valor, status || "Pendente"]
      );

      return res.status(201).json(result.rows[0]);
    }

    // -------- PUT --------
    if (method === "PUT") {
      const { id, status } = body;

      if (!id || !status) {
        return res.status(400).json({ error: "ID e status são obrigatórios" });
      }

      const result = await query(
        "UPDATE contasareceber SET status = $1 WHERE id = $2 RETURNING *",
        [status, id]
      );

      return res.status(200).json(result.rows[0]);
    }

    // -------- DELETE (🔥 FALTAVA ESSE) --------
    if (method === "DELETE") {
      const { id } = queryParams;

      if (!id) {
        return res.status(400).json({ error: "ID é obrigatório" });
      }

      await query("DELETE FROM contasareceber WHERE id = $1", [id]);

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Método não permitido" });

  } catch (err) {
    console.error("Erro na API:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}
