CREATE TABLE "graph_composition_subgraphs" (
	"graph_id" uuid,
	"composition_revision" bigint,
	"subgraph_id" uuid,
	"subgraph_revision" bigint NOT NULL,
	"subgraph_schema_revision" bigint NOT NULL,
	CONSTRAINT "graph_composition_subgraphs_pkey" PRIMARY KEY("graph_id","composition_revision","subgraph_id")
);

CREATE TABLE "graph_compositions" (
	"graph_id" uuid,
	"revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_compositions_pkey" PRIMARY KEY("graph_id","revision")
);

CREATE TABLE "graph_revisions" (
	"graph_id" uuid,
	"revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_revisions_pkey" PRIMARY KEY("graph_id","revision")
);

CREATE TABLE "graphs" (
	"id" uuid PRIMARY KEY,
	"slug" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_composition_revision" bigint,
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
	CONSTRAINT "subgraph_revisions_pkey" PRIMARY KEY("subgraph_id","revision")
);

CREATE TABLE "subgraph_schema_revisions" (
	"subgraph_id" uuid,
	"revision" bigint,
	"normalized_sdl" text NOT NULL,
	"normalized_sdl_sha256" bytea GENERATED ALWAYS AS (digest("normalized_sdl", 'sha256')) STORED NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subgraph_schema_revisions_pkey" PRIMARY KEY("subgraph_id","revision")
);

CREATE TABLE "subgraphs" (
	"id" uuid PRIMARY KEY,
	"graph_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_schema_revision" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "supergraph_schemas" (
	"graph_id" uuid,
	"composition_revision" bigint,
	"supergraph_sdl" text NOT NULL,
	"supergraph_sdl_sha256" bytea GENERATED ALWAYS AS (digest("supergraph_sdl", 'sha256')) STORED NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supergraph_schemas_pkey" PRIMARY KEY("graph_id","composition_revision")
);

CREATE UNIQUE INDEX "graphs_slug_index" ON "graphs" ("slug") WHERE "deleted_at" is null;
CREATE UNIQUE INDEX "subgraphs_graph_id_slug_index" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" is null;
ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_rRd34UT5CiiN_fkey" FOREIGN KEY ("graph_id","composition_revision") REFERENCES "graph_compositions"("graph_id","revision");
ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_qCgBGQzYmLzM_fkey" FOREIGN KEY ("subgraph_id","subgraph_revision") REFERENCES "subgraph_revisions"("subgraph_id","revision");
ALTER TABLE "graph_composition_subgraphs" ADD CONSTRAINT "graph_composition_subgraphs_dRFQxJjCl4dA_fkey" FOREIGN KEY ("subgraph_id","subgraph_schema_revision") REFERENCES "subgraph_schema_revisions"("subgraph_id","revision");
ALTER TABLE "graph_compositions" ADD CONSTRAINT "graph_compositions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "graph_revisions" ADD CONSTRAINT "graph_revisions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_Yk2WCKHpXOLW_fkey" FOREIGN KEY ("id","current_composition_revision") REFERENCES "graph_compositions"("graph_id","revision");
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_5CnmrsEEZkxa_fkey" FOREIGN KEY ("id","current_supergraph_schema_revision") REFERENCES "supergraph_schemas"("graph_id","composition_revision");
ALTER TABLE "subgraph_revisions" ADD CONSTRAINT "subgraph_revisions_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraph_schema_revisions" ADD CONSTRAINT "subgraph_schema_revisions_subgraph_id_subgraphs_id_fkey" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_OPMtMISAZ6ya_fkey" FOREIGN KEY ("id","current_schema_revision") REFERENCES "subgraph_schema_revisions"("subgraph_id","revision");
ALTER TABLE "supergraph_schemas" ADD CONSTRAINT "supergraph_schemas_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "supergraph_schemas" ADD CONSTRAINT "supergraph_schemas_euVXCEkVsz7Q_fkey" FOREIGN KEY ("graph_id","composition_revision") REFERENCES "graph_compositions"("graph_id","revision");
