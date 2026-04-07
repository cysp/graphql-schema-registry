CREATE TABLE "graph_revisions" (
	"graph_id" uuid,
	"revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_revisions_pkey" PRIMARY KEY("graph_id","revision"),
	CONSTRAINT "graph_revisions_revision_positive" CHECK ("revision" > 0)
);

CREATE TABLE "graphs" (
	"id" uuid PRIMARY KEY,
	"slug" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_supergraph_schema_revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "subgraph_revisions" (
	"subgraph_id" uuid,
	"revision" bigint,
	"routing_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subgraph_revisions_pkey" PRIMARY KEY("subgraph_id","revision"),
	CONSTRAINT "subgraph_revisions_revision_positive" CHECK ("revision" > 0)
);

CREATE TABLE "subgraph_schema_revisions" (
	"subgraph_id" uuid,
	"revision" bigint,
	"normalized_sdl" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subgraph_schema_revisions_pkey" PRIMARY KEY("subgraph_id","revision"),
	CONSTRAINT "subgraph_schema_revisions_revision_positive" CHECK ("revision" > 0),
	CONSTRAINT "subgraph_schema_revisions_normalized_hash_sha256_hex" CHECK ("normalized_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "subgraphs" (
	"id" uuid PRIMARY KEY,
	"graph_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_schema_revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "subgraphs_id_graph_id_unique" UNIQUE("id","graph_id")
);

CREATE TABLE "supergraph_schema_revision_subgraphs" (
	"graph_id" uuid,
	"supergraph_schema_revision" bigint,
	"subgraph_id" uuid,
	"subgraph_revision" bigint NOT NULL,
	"subgraph_schema_revision" bigint NOT NULL,
	CONSTRAINT "supergraph_schema_revision_subgraphs_pkey" PRIMARY KEY("graph_id","supergraph_schema_revision","subgraph_id")
);

CREATE TABLE "supergraph_schema_revisions" (
	"graph_id" uuid,
	"revision" bigint,
	"supergraph_sdl" text NOT NULL,
	"schema_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supergraph_schema_revisions_pkey" PRIMARY KEY("graph_id","revision"),
	CONSTRAINT "supergraph_schema_revisions_revision_positive" CHECK ("revision" > 0),
	CONSTRAINT "supergraph_schema_revisions_schema_hash_sha256_hex" CHECK ("schema_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "graphs_slug_index" ON "graphs" ("slug") WHERE "deleted_at" is null;
CREATE INDEX "subgraph_schema_revisions_subgraph_id_normalized_hash_index" ON "subgraph_schema_revisions" ("subgraph_id","normalized_hash");
CREATE UNIQUE INDEX "subgraphs_graph_id_slug_index" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" is null;
CREATE INDEX "supergraph_schema_revision_subgraphs_subgraph_id_index" ON "supergraph_schema_revision_subgraphs" ("subgraph_id");
ALTER TABLE "graph_revisions" ADD CONSTRAINT "graph_revisions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "subgraph_revisions" ADD CONSTRAINT "subgraph_revisions_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraph_schema_revisions" ADD CONSTRAINT "subgraph_schema_revisions_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "supergraph_schema_revision_subgraphs" ADD CONSTRAINT "supergraph_schema_revision_subgraphs_q6dUnBYl0mnW_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "supergraph_schema_revisions" ADD CONSTRAINT "supergraph_schema_revisions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
