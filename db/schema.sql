CREATE TABLE "graph_revisions" (
	"graph_id" uuid,
	"revision" bigint,
	"federation_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_revisions_pkey" PRIMARY KEY("graph_id","revision")
);

CREATE TABLE "graphs" (
	"id" uuid PRIMARY KEY,
	"slug" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "subgraph_revisions" (
	"subgraph_id" uuid,
	"revision" bigint,
	"routing_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subgraph_revisions_pkey" PRIMARY KEY("subgraph_id","revision")
);

CREATE TABLE "subgraphs" (
	"id" uuid PRIMARY KEY,
	"graph_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE INDEX "graph_revisions_graph_idx" ON "graph_revisions" ("graph_id");
CREATE UNIQUE INDEX "graphs_active_slug_uniq" ON "graphs" ("slug") WHERE "deleted_at" is null;
CREATE INDEX "graphs_active_slug_idx" ON "graphs" ("slug") WHERE "deleted_at" is null;
CREATE INDEX "subgraph_revisions_subgraph_idx" ON "subgraph_revisions" ("subgraph_id");
CREATE UNIQUE INDEX "subgraphs_graph_active_slug_uniq" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" is null;
CREATE INDEX "subgraphs_graph_active_slug_idx" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" is null;
CREATE INDEX "subgraphs_graph_idx" ON "subgraphs" ("graph_id");
ALTER TABLE "graph_revisions" ADD CONSTRAINT "graph_revisions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "subgraph_revisions" ADD CONSTRAINT "subgraph_revisions_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
