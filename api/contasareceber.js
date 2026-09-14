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

// Tolerância para comparação de valores em ponto flutuante
const EPS = 0.005;

export default async function handler(req, res) {
  const { method, body, query: queryParams } = req;

  try {

    // -------- GET --------
    if (method === "GET") {
      const result = await query(`
        SELECT 
          c.id, 
          COALESCE(cl.nome, 'Cliente não encontrado') AS cliente,
          c.cliente_id,
          c.valor, 
          c.valor_pago,
          (c.valor - c.valor_pago) AS valor_pendente,
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
        `INSERT INTO contasareceber (cliente_id, valor, valor_pago, status, data)
         VALUES ($1,$2,0,$3,NOW()) RETURNING *`,
        [cliente_id, valor, status || "Pendente"]
      );

      return res.status(201).json(result.rows[0]);
    }

    // -------- PUT --------
    if (method === "PUT") {
      const { id, status, valor_recebido, forma_pagamento } = body;

      if (!id) {
        return res.status(400).json({ error: "ID é obrigatório" });
      }

      // ---- Fluxo novo: recebimento (parcial ou total) ----
      if (valor_recebido != null) {
        const valorRecebido = Number(valor_recebido);

        if (!forma_pagamento) {
          return res.status(400).json({ error: "Forma de pagamento é obrigatória" });
        }
        if (!(valorRecebido > 0)) {
          return res.status(400).json({ error: "Valor recebido deve ser maior que zero" });
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const contaResult = await client.query(
            "SELECT * FROM contasareceber WHERE id = $1 FOR UPDATE",
            [id]
          );
          const conta = contaResult.rows[0];

          if (!conta) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Conta não encontrada" });
          }

          const valorOriginal = Number(conta.valor);
          const valorJaPago = Number(conta.valor_pago) || 0;
          const pendenteAtual = valorOriginal - valorJaPago;

          if (valorRecebido > pendenteAtual + EPS) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              error: `Valor informado (R$ ${valorRecebido.toFixed(2)}) é maior que o valor pendente (R$ ${pendenteAtual.toFixed(2)})`
            });
          }

          const novoValorPago = valorJaPago + valorRecebido;
          const novoStatus = novoValorPago >= valorOriginal - EPS ? "Pago" : "Parcial";

          const contaAtualizada = await client.query(
            `UPDATE contasareceber
             SET valor_pago = $1, status = $2
             WHERE id = $3
             RETURNING *`,
            [novoValorPago, novoStatus, id]
          );

          // Cria a "venda" correspondente a este recebimento, para
          // entrar no total de vendas e no relatório.
          const vendaResult = await client.query(
            `INSERT INTO vendas (cliente_id, forma_pagamento, total, desconto, data, cancelada)
             VALUES ($1, $2, $3, 0, NOW(), false)
             RETURNING id`,
            [conta.cliente_id, forma_pagamento, valorRecebido]
          );
          const vendaId = vendaResult.rows[0].id;

          await client.query(
            `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco, descricao_manual)
             VALUES ($1, NULL, 1, $2, $3)`,
            [vendaId, valorRecebido, `Recebimento de fiado - ${forma_pagamento}`]
          );

          // Histórico do recebimento, ligado à conta e à venda gerada
          await client.query(
            `INSERT INTO contasareceber_pagamentos (conta_id, venda_id, valor, forma_pagamento)
             VALUES ($1, $2, $3, $4)`,
            [id, vendaId, valorRecebido, forma_pagamento]
          );

          await client.query("COMMIT");

          return res.status(200).json({
            conta: contaAtualizada.rows[0],
            valor_recebido: valorRecebido,
            valor_pendente: valorOriginal - novoValorPago,
            venda_id: vendaId
          });
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }

      // ---- Fluxo antigo: apenas trocar o status manualmente ----
      if (!status) {
        return res.status(400).json({ error: "Status é obrigatório" });
      }

      const result = await query(
        "UPDATE contasareceber SET status = $1 WHERE id = $2 RETURNING *",
        [status, id]
      );

      return res.status(200).json(result.rows[0]);
    }

    // -------- DELETE --------
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
