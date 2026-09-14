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
          c.desconto,
          (c.valor - c.valor_pago - c.desconto) AS valor_pendente,
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

      // ---- Fluxo novo: recebimento (parcial ou total), com desconto opcional ----
      if (valor_recebido != null || body.desconto != null) {
        const valorRecebido = Number(valor_recebido) || 0;
        const descontoAplicado = Number(body.desconto) || 0;
        const totalAbatido = valorRecebido + descontoAplicado;

        if (valorRecebido > 0 && !forma_pagamento) {
          return res.status(400).json({ error: "Forma de pagamento é obrigatória quando há valor recebido" });
        }
        if (!(totalAbatido > 0)) {
          return res.status(400).json({ error: "Informe um valor recebido e/ou um desconto maior que zero" });
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
          const descontoJaDado = Number(conta.desconto) || 0;
          const pendenteAtual = valorOriginal - valorJaPago - descontoJaDado;

          if (totalAbatido > pendenteAtual + EPS) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              error: `Valor recebido + desconto (R$ ${totalAbatido.toFixed(2)}) é maior que o valor pendente (R$ ${pendenteAtual.toFixed(2)})`
            });
          }

          const novoValorPago = valorJaPago + valorRecebido;
          const novoDesconto = descontoJaDado + descontoAplicado;
          const novoStatus = (novoValorPago + novoDesconto) >= valorOriginal - EPS ? "Pago" : "Parcial";

          const contaAtualizada = await client.query(
            `UPDATE contasareceber
             SET valor_pago = $1, desconto = $2, status = $3
             WHERE id = $4
             RETURNING *`,
            [novoValorPago, novoDesconto, novoStatus, id]
          );

          let vendaId = null;

          // Só cria "venda" (para entrar no relatório/total de vendas) se
          // houve dinheiro de fato recebido. Desconto puro não é venda.
          if (valorRecebido > 0) {
            const vendaResult = await client.query(
              `INSERT INTO vendas (cliente_id, forma_pagamento, total, desconto, data, cancelada)
               VALUES ($1, $2, $3, 0, NOW(), false)
               RETURNING id`,
              [conta.cliente_id, forma_pagamento, valorRecebido]
            );
            vendaId = vendaResult.rows[0].id;

            const descricao = descontoAplicado > 0
              ? `Recebimento de fiado - ${forma_pagamento} (desconto R$ ${descontoAplicado.toFixed(2)})`
              : `Recebimento de fiado - ${forma_pagamento}`;

            await client.query(
              `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco, descricao_manual)
               VALUES ($1, NULL, 1, $2, $3)`,
              [vendaId, valorRecebido, descricao]
            );
          }

          // Histórico do recebimento/desconto, ligado à conta e à venda gerada
          await client.query(
            `INSERT INTO contasareceber_pagamentos (conta_id, venda_id, valor, desconto, forma_pagamento)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, vendaId, valorRecebido, descontoAplicado, valorRecebido > 0 ? forma_pagamento : "desconto"]
          );

          await client.query("COMMIT");

          return res.status(200).json({
            conta: contaAtualizada.rows[0],
            valor_recebido: valorRecebido,
            desconto_aplicado: descontoAplicado,
            valor_pendente: valorOriginal - novoValorPago - novoDesconto,
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
