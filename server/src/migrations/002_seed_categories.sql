-- 002_seed_categories.sql
-- Default category tree in Portuguese (pt-PT) with 50/30/20 budget_group tags

-- 1. Expenses: Habitação (Needs)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (1, NULL, 'Habitação', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (1, 'Renda / Prestação', 'expense', 'needs'),
  (1, 'Eletricidade', 'expense', 'needs'),
  (1, 'Água', 'expense', 'needs'),
  (1, 'Gás', 'expense', 'needs'),
  (1, 'Internet / TV / Telemóvel', 'expense', 'needs'),
  (1, 'Condomínio', 'expense', 'needs');

-- 2. Expenses: Alimentação
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (10, NULL, 'Alimentação', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (10, 'Supermercado', 'expense', 'needs'),
  (10, 'Restaurantes', 'expense', 'wants');

-- 3. Expenses: Transportes (Needs)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (20, NULL, 'Transportes', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (20, 'Combustível', 'expense', 'needs'),
  (20, 'Transportes públicos', 'expense', 'needs'),
  (20, 'Seguro automóvel', 'expense', 'needs'),
  (20, 'Manutenção automóvel', 'expense', 'needs');

-- 4. Expenses: Saúde (Needs)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (30, NULL, 'Saúde', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (30, 'Consultas e Exames', 'expense', 'needs'),
  (30, 'Farmácia', 'expense', 'needs'),
  (30, 'Seguro de Saúde', 'expense', 'needs');

-- 5. Expenses: Lazer & Estilo de Vida (Wants)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (40, NULL, 'Lazer', 'expense', 'wants');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (40, 'Viagens e Férias', 'expense', 'wants'),
  (40, 'Passatempos e Cultura', 'expense', 'wants'),
  (40, 'Vestuário e Calçado', 'expense', 'wants');

-- 6. Expenses: Subscrições (Wants)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (50, NULL, 'Subscrições', 'expense', 'wants');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (50, 'Streaming (Netflix, Spotify, etc.)', 'expense', 'wants'),
  (50, 'Software e Serviços Digitais', 'expense', 'wants'),
  (50, 'Ginásio', 'expense', 'wants');

-- 7. Expenses: Educação (Needs)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (60, NULL, 'Educação', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (60, 'Propinas e Escolaridade', 'expense', 'needs'),
  (60, 'Livros e Material Escolar', 'expense', 'needs'),
  (60, 'Cursos e Formação', 'expense', 'needs');

-- 8. Expenses: Impostos & Encargos Legais (Needs)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (70, NULL, 'Impostos', 'expense', 'needs');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (70, 'IUC', 'expense', 'needs'),
  (70, 'IMI', 'expense', 'needs'),
  (70, 'IRS', 'expense', 'needs');

-- 9. Expenses: Poupança & Investimentos (Savings)
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (80, NULL, 'Poupança', 'expense', 'savings');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (80, 'Fundo de Emergência', 'expense', 'savings'),
  (80, 'PPR / Reforma', 'expense', 'savings'),
  (80, 'Investimentos', 'expense', 'savings');

-- 10. Expenses: Outras Despesas
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (90, NULL, 'Outras Despesas', 'expense', 'wants');
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (90, 'Presentes e Doações', 'expense', 'wants'),
  (90, 'Despesas Diversas', 'expense', 'wants');

-- 11. Incomes: Rendimentos
INSERT INTO categories (id, parent_id, name, kind, budget_group) VALUES (100, NULL, 'Rendimentos', 'income', NULL);
INSERT INTO categories (parent_id, name, kind, budget_group) VALUES
  (100, 'Salário', 'income', NULL),
  (100, 'Subsídio de Alimentação', 'income', NULL),
  (100, 'Subsídio de Férias / Natal', 'income', NULL),
  (100, 'Rendimentos de Investimentos', 'income', NULL),
  (100, 'Outros Rendimentos', 'income', NULL);
