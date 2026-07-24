\section{Introduction}
\label{sec:introduction}

\IEEEPARstart{U}nderground mining presents a demanding visual analytics setting. A mine integrates roadways and infrastructure, geological structures, monitoring assets, ventilation networks, production entities, people and vehicles, and articulated equipment within a shared three-dimensional environment. Information about these entities is distributed across tables, logs, three-dimensional models, network descriptions, time-indexed states, and simulation outputs. Visual analysis therefore extends beyond rendering a complex spatial scene. Users must relate spatial distributions, network connectivity, temporal variation, and model-generated scenario evolution across coupled systems. Representative tasks include environmental state inspection, ventilation and airflow analysis, geological interpretation, equipment-motion analysis, and hazard simulation and response.

\begin{figure}[htbp]
\centering
\includegraphics[width=\linewidth]{imgs/teaser.png}
\caption{Underground mining visual analytics involves multiple coupled entities and systems within a shared spatial environment. Representative analysis contexts include environmental state inspection, ventilation and airflow analysis, hazard simulation and response, and geology interpretation.}
\label{fig:teaser}
\end{figure}

Current practice commonly addresses these requirements through project-specific applications. Such systems are often developed around fixed data sources, predefined views, and delivery-specific interaction logic. They can satisfy immediate project goals, but later changes to data, analysis requirements, or workspace organization frequently require substantial redevelopment. General visualization frameworks and grammars provide expressive implementation mechanisms, while visual authoring and flow-based systems reduce parts of the programming burden. Their abstractions, however, commonly remain centered on code and specifications, visual encodings, data transformations, or generic data- and logic-flow composition. At the other end of the spectrum, domain visual analytics applications expose task-oriented functions to end users but often provide limited support for reusable project-level assembly.

Our design-study collaboration revealed an important role between visualization developers and domain end users. We refer to this role as the \emph{configurator}. Configurators may be implementation engineers, requirement practitioners, project delivery personnel, or technically experienced domain experts. They understand visual analytics requirements, project data, deployment constraints, and end-user feedback, and they communicate missing data or capability needs to developers. Their primary responsibility is to assemble and adapt a deployable application, rather than to implement visualization algorithms or construct generic dataflow and interaction logic. An authoring model for this role should therefore operate at the level of domain data, reusable visual-analytic capabilities, and task-oriented workspaces.

\begin{figure}[htbp]
\centering
\includegraphics[width=\linewidth]{imgs/role.png}
\caption{Positioning MineVis in the visualization authoring landscape. Visualization programming frameworks and visual authoring or flow-based systems primarily support implementation-oriented creation at different abstraction levels, while domain visual analytics applications support task-oriented end-user use. MineVis explicitly targets the intermediate configurator role through capability-level assembly of semantic datasets, reusable operators, and workspaces.}
\label{fig:role}
\end{figure}

To support this intermediate role, we present \emph{MineVis}, a configurable visual analytics framework for underground mining. MineVis organizes application assembly through a Data--Operator--Module (D-O-M) architecture. The Data layer turns heterogeneous project sources into semantic datasets defined by reusable contracts. The Operator layer packages recurring visual-analytic capabilities at a granularity meaningful to configurators. The Module layer organizes configured operators into end-user-facing workspaces and coordinates their functions and visual contributions. The D-O-M graph is a configurator-facing authoring representation: configurators select capabilities, bind the semantic datasets they require, adjust parameters, and organize them into modules. At runtime, Module Nodes become workspaces and configured operator capabilities are exposed as functions. End users interact with these workspaces, functions, and visual contributions without needing to understand the internal authoring graph.

MineVis was developed through an iterative design-study-style collaboration from 2022 to 2026 across eight independent engineering projects and with twelve long-term software and domain experts. Requirement discussions, field observations, technical meetings, implementation and deployment iterations, and post-deployment reflection informed the framework design. These activities shaped the boundaries of semantic datasets, the granularity of operator capabilities, module-level coordination, and the separation between configurator-facing authoring and end-user-facing use. We demonstrate MineVis through representative cases in environmental state analysis, ventilation and airflow analysis, hazard simulation and response, and geology interpretation. We evaluate the framework through a coverage and expressiveness analysis grounded in the engineering projects, an independent task-based study with configurator-like participants, and expert utility feedback. To support reproducibility, we also release an open-source MineVis prototype and live demo that preserve the core D-O-M authoring workflow and representative examples while replacing confidential data and proprietary components with structure-preserving equivalents.\footnote{\url{https://github.com/Housz/MineVis}}

Our contributions are as follows:

\begin{itemize}

\item We provide a domain-grounded characterization of underground mining visual analytics and identify the configurator as an explicit intermediate role between reusable visualization development and end-user analysis. From the design-study process, we derive requirements for modular assembly, semantic data organization, reusable visual-analytic capabilities, configurator-oriented authoring, and deployment utility.

\item We introduce the D-O-M architecture and its role-aware authoring and runtime model. The architecture separates developer-side reusable implementation, configurator-side capability assembly, and end-user-facing workspaces and functions.

\item We develop reusable Data and Operator abstractions for underground mining visual analytics. These include developer-facing Data Templates, semantic dataset contracts and Data Node semanticization, a domain-grounded dataset taxonomy, a formal operator model, and an operator taxonomy organized by spatial, topological, temporal, and simulation-oriented visual analytics operations. The Module layer complements these abstractions through shared context, coordinated visual contributions, dataset closure, and visual contribution lifecycle management.

\item We demonstrate and evaluate MineVis through representative case studies, coverage analysis across engineering deployments, an independent configurator usability study, and expert utility feedback. The evaluation examines the framework's expressiveness, authoring usability, role alignment, and practical deployment value.

\end{itemize}
\section{Design Requirements}
\label{sec:design-requirements}

\subsection{Domain Characterization}
\label{sec:domain-characterization}

To ground MineVis in real practice, we followed a design-study-style process through a long-term collaboration from 2022 to 2026 with mining software and domain experts. The collaboration involved eight independent engineering projects, denoted as D1--D8, and twelve expert participants, denoted as P1--P12. 
The projects covered representative mining visual analytics scenarios, including mine digital twins, transparent geological support, hazard analysis and early warning, intelligent ventilation visualization, and robotics simulation and visualization.
The participants included three groups: senior mining visualization and software experts (P1--P4), implementation, requirement, and deployment practitioners (P5--P9), and mine-side domain experts in geology, safety, production, and management (P10--P12).

The process was iterative rather than a one-time requirement elicitation. We first learned from requirement discussions, field observations, and technical meetings to characterize recurring domain entities and systems, visual-analytic task patterns, data roles, and workflow constraints. We then synthesized these observations into three framework directions: semantic data organization, reusable visual-analytic capability abstraction, and configurator-oriented workspace assembly. These directions gradually became the core Data, Operator, and Module architecture of MineVis. During implementation and deployment across D1--D8, the framework was repeatedly adapted to project-specific data sources, task requirements, and feedback from configurators and mine-side users. Reflection after deployments further shaped key design decisions, including dataset boundaries, operator granularity, module-level coordination, and the separation between configurator-facing authoring and end-user-facing workspaces.


\textbf{Multiple domain entities and systems.}
Underground mining visualization does not revolve around a single analysis target. Across D1--D8, the recurring domain entities and systems include roadways and infrastructure, geology and resources, monitoring and sensing assets, production and operational entities, ventilation networks, people and vehicles, robots and equipment, and safety-related states. These entities and systems are not independent layers. Sensor observations are interpreted relative to roadway and ventilation structures, hazards evolve within spatial and topological constraints, and personnel or equipment states are meaningful only in operational and safety contexts. This indicates the need for domain-entity-oriented representations rather than isolated data fragments.

\textbf{Coupled analysis domains.}
The recurring visual-analytic task patterns repeatedly span spatial, topological, temporal, and simulation-oriented analysis. In practice, these domains rarely appear in isolation. Environmental analysis combines temporal observations with roadway spatial context, ventilation reasoning combines network structure with dynamic airflow states, geological interpretation combines spatial structures with borehole and attribute information, and emergency analysis combines spatial layout, connectivity constraints, temporal evolution, and what-if exploration. This implies that mining visualization frameworks must support coordinated analysis across multiple domains rather than separate task-specific tools.

\textbf{Heterogeneous data roles and representations.}
The projects show that mining data are heterogeneous not only in source, but also in semantic role and representation. They include static structures such as roadway geometry, geological bodies, infrastructure objects, and equipment models; time-indexed states such as sensor readings, production logs, ventilation settings, mobility traces, and equipment states; derived distributions such as environmental fields, airflow states, hazard regions, and risk maps; and scenario-dependent outputs generated by simulation and planning. The same domain object may also appear in multiple representations, such as graphs, meshes, centerlines, tables, identifiers, or service outputs. This makes raw-source-centered handling insufficient for reusable applications and motivates a semantic data abstraction.

\textbf{A distinct assembly layer in practice.}
The projects further reveal a recurring gap between reusable implementation and end-user operation. Developers build technical components such as data adaptors, algorithms, visualization modules, and interaction mechanisms. Mine-side users consume completed applications to inspect, monitor, compare, simulate, and make decisions. Between them, there is often a practical assembly layer responsible for selecting data, adapting project sources, choosing analysis capabilities, configuring parameters, and organizing deployable workspaces. This responsibility may be taken by implementation engineers, requirement analysts, project managers, or technically experienced domain personnel. We refer to this logical role as the configurator. Its repeated presence suggests that the key challenge is not only building mining visualization functions, but enabling application assembly without turning it into full-scale programming.

This characterization shows that underground mining visualization must address multiple object systems, coupled analysis domains, heterogeneous data roles, and distinct lifecycle responsibilities. It directly motivates the need for semantic data organization, reusable capability abstraction, and configuration-oriented application assembly in MineVis.

\subsection{Limitations of Existing Practice}
\label{sec:limitations-practice}

Although the projects described above differ in scope and business focus, they reveal several recurring limitations in current underground mining visualization practice. These limitations are not isolated implementation issues. Rather, they reflect how mining visualization systems are typically conceived, built, and delivered.

\textbf{Project-specific bespoke systems.} Current mining visualization solutions are commonly developed for a particular mine, subsystem, or delivery objective. This leads to systems in which data processing, analysis logic, visual encoding, and interaction design are tightly tied to one project context. Such systems may satisfy short-term delivery goals, but they are difficult to adapt when requirements evolve, when data structures change, or when similar needs arise in another project. As a result, conceptually similar functions are often repeatedly reimplemented.

\textbf{Fragmented data handling.} In practice, roadway structures, sensor registries, temporal readings, geological models, ventilation networks, equipment models, and safety indicators are usually managed as separate files, tables, models, or service outputs. Even when these sources refer to the same domain object system, their relationships are often resolved only in project-specific scripts or application code. This weakens reuse, increases adaptation effort, and makes cross-system consistency difficult to maintain.

\textbf{Function-level coupling.} Visualization and analysis functions are typically implemented as application-specific features rather than reusable capability units. Spatial coloring, trend inspection, warning display, route analysis, or scenario views are often embedded directly in one interface and one workflow. This makes it difficult to distinguish reusable analytic capability from project-specific application logic, and system extension often becomes the accumulation of special-case implementations.

\textbf{Mismatch with generic platforms.} Generic visualization tools and low-code systems may provide modular widgets or flexible pipelines, but they often require users to think in terms of low-level dataflow composition or logic orchestration. This does not align well with the way mining applications are assembled in practice. Configurators typically need to compose domain-relevant datasets, analysis capabilities, and views, not to author implementation-level transformation chains. When platforms expose low-level flow logic instead of domain-oriented semantic objects and capability blocks, the burden of assembly remains high.

These limitations point to a broader framework challenge: mining visualization systems need semantic data organization, reusable capability abstraction, and configuration-oriented application assembly, rather than another set of project-specific applications.


\subsection{Design Requirements}
\label{sec:requirements}

Based on the domain characterization in Section~\ref{sec:domain-characterization} and the recurring limitations identified in Section~\ref{sec:limitations-practice}, we derive five design requirements for a configurable visual analytics framework for underground mining. These requirements are not feature requests for a single application. Rather, they summarize the conditions that such a framework should satisfy in order to support reusable, configurable, and deployment-oriented mining visualization systems.

\textbf{DR1. Decoupled and modular application assembly.}
Mining visualization projects require a separation between reusable technical implementation and project-specific application assembly. Current bespoke systems often tightly couple data handling, visual encoding, interaction logic, and delivery-specific workflows, making later adaptation difficult. A framework for this domain should therefore support modular assembly in which reusable data and capability components can be configured into project-specific applications without rebuilding the system for each deployment.

\textbf{DR2. Domain-level organization of heterogeneous mining data.}
Underground mining data are heterogeneous in source, format, representation, lifecycle, and semantic role. Configurators need to work with meaningful mining entities and systems, such as roadways, sensor registries, ventilation networks, geological bodies, equipment states, and hazard states, rather than with isolated files, tables, models, or service outputs. A framework should therefore organize heterogeneous inputs into domain-level data units that preserve mining semantics while hiding unnecessary source-level fragmentation.

\textbf{DR3. Reusable visual-analytic capability abstraction.}
Mining applications repeatedly require capabilities such as spatial inspection, temporal trend analysis, topological reasoning, field overlay, route analysis, warning display, and scenario exploration. In existing systems, these capabilities are often embedded in project-specific interfaces or workflows, which limits reuse. A framework should expose recurring visualization and analysis capabilities as reusable units that can be configured and recomposed across different mining scenarios.

\textbf{DR4. Domain-oriented authoring for configurators.}
The practical assembly of mining visualization applications is often carried out by configurators who understand project requirements and deployment constraints but do not act as framework developers. These users need an authoring model based on domain data, analysis capabilities, and task-oriented workspaces, rather than low-level dataflow programming, event-chain scripting, or implementation-centric orchestration. A framework should therefore support interactive authoring that matches the configurator's role and mental model.

\textbf{DR5. Real-world task coverage and deployment utility.}
A configurable framework is useful only if it can express recurring real mining visual analytics tasks and support practical deployment workflows. It should cover diverse mining entities, analysis domains, and task families while remaining adaptable to project-specific data sources, requirement changes, and user feedback. This requirement calls for evidence from representative workspaces, real engineering deployments, configurator usability, and expert utility feedback.

The following sections respond to these requirements. Section~\ref{sec:minevis-framework} introduces the D-O-M architecture for modular assembly and domain-oriented authoring. Section~\ref{sec:data} addresses DR2 through data templates, semantic datasets, and Data Node semanticization. Section~\ref{sec:operator} addresses DR3 through reusable operator definitions and taxonomy. Section~\ref{sec:module} further supports DR4 by explaining workspaces, functions, and module-level coordination. Sections~\ref{sec:case-studies} and~\ref{sec:evaluation} examine DR5 through representative cases, coverage analysis, configurator usability, and expert utility evaluation.


\section{MineVis Framework} \label{sec:minevis-framework}


\subsection{Overview}
\label{sec:framework-overview}

MineVis addresses the requirements in Section~\ref{sec:requirements} through a configurable Data--Operator--Module architecture. The framework separates reusable implementation from project-level application assembly: developers provide reusable data abstractions and visual-analytic capabilities, configurators assemble project-specific applications through the D-O-M authoring interface, and end users interact with the resulting workspaces and functions. This organization supports modular application construction while keeping authoring aligned with mining domain concepts rather than low-level implementation logic.

The three layers play complementary roles. The Data layer semanticizes heterogeneous project sources into domain-level datasets that represent mining entities, relations, and states. The Operator layer encapsulates reusable visualization and analysis capabilities over these datasets. 
The Module layer organizes configured operators into end-user-facing workspaces, where functions, visual contributions, and interactions are presented for specific visual analytics tasks.
Through this separation, MineVis treats underground mining applications as configurable compositions of semantic data and reusable capabilities, rather than as monolithic project-specific systems.
The D-O-M graph is configurator-facing, while workspaces and functions are end-user-facing. At runtime, a Module Node becomes a workspace, and configured operator capabilities are exposed as functions within that workspace. End users interact with workspaces, functions, and visual contributions rather than with the internal authoring graph; these runtime concepts are detailed in Section~\ref{sec:module}.


Figure~\ref{fig:framework} summarizes the framework architecture and the transition from reusable implementation to configurator-oriented authoring and runtime use. Section~\ref{sec:dom-architecture} introduces the responsibilities of the three D-O-M layers, and Section~\ref{sec:authoring-runtime-flow} describes how an authored node graph is interpreted as runtime workspaces. The following three sections then detail the Data, Operator, and Module layers.



\begin{figure*}[htbp]
	\centering
	\includegraphics[width=1.0\linewidth]{imgs/framework.png}
	\caption{MineVis framework architecture. Developers provide reusable data abstractions and operator implementations; configurators assemble Data Nodes, Operator Nodes, and Module Nodes through the D-O-M authoring interface; end users interact with the resulting workspaces and functions at runtime.}
\label{fig:framework}
\end{figure*}


\subsection{D-O-M Architecture}
\label{sec:dom-architecture}

The D-O-M architecture separates three concerns that repeatedly appeared in the design-study process: semantic data organization, reusable visual-analytic capabilities, and configurator-oriented workspace assembly. These concerns correspond to the Data, Operator, and Module layers of MineVis. The layers are connected through semantic dataset instances, operator capabilities, and module-level workspace organization. This architecture allows reusable implementation to remain separate from project-specific application assembly, while still preserving a coherent path from authored configurations to end-user-facing visual analytics workspaces.

\textbf{Data layer.}
The Data layer provides the semantic substrate of MineVis. It organizes heterogeneous project sources into domain-level datasets that represent mining entities, relations, and states. Data Nodes instantiate these datasets from project-specific sources through semanticization, allowing downstream operators to consume stable data objects rather than raw files, isolated tables, or project-specific model fragments. The Data layer therefore separates domain-level data meaning from source-level handling and provides the common semantic basis for reusable visual analytics capabilities. The detailed data abstraction is introduced in Section~\ref{sec:data}.

\textbf{Operator layer.}
The Operator layer provides reusable visual-analytic capabilities over semantic datasets. Operators encapsulate capabilities such as spatial inspection, temporal trend analysis, network reasoning, field overlay, route analysis, and scenario exploration. They consume semantic datasets and configurable parameters, contribute visual outputs to application workspaces, and may produce derived semantic datasets for downstream analysis. The Operator layer therefore separates reusable analysis intent from project-specific interface logic. The operator definition and taxonomy are introduced in Section~\ref{sec:operator}.

\textbf{Module layer.}
The Module layer organizes configured operators into end-user-facing workspaces. During authoring, configurators assign selected operators to Module Nodes to specify which capabilities belong to the same visual analytics task. At runtime, these Module Nodes are presented as workspaces in which functions, visual contributions, and interactions are organized for end users. The Module layer therefore connects configurator-side assembly with end-user-facing application organization. The detailed semantics of workspaces, functions, module-level coordination, and visual contribution management are introduced in Section~\ref{sec:module}.

These layers define the main responsibility boundaries of MineVis. Developers extend data and operator libraries, configurators assemble project-specific applications through D-O-M nodes, and end users interact with the resulting workspaces and functions. The next section describes how this architecture is realized through the authoring and runtime flow.

\subsection{Authoring and Runtime Flow}
\label{sec:authoring-runtime-flow}

The D-O-M architecture is realized through a separation between configurator-oriented authoring and end-user runtime operation. In the authoring stage, configurators begin from visual analytics requirements. Given a target task, the configurator selects Operator Nodes that capture the required visual-analytic capabilities, such as roadway scalar analysis, ventilation network inspection, branch trend analysis, or hazard simulation. Each operator declares the semantic dataset types it requires and the parameters that can be configured. The configurator then creates, selects, or binds Data Nodes to satisfy these dataset requirements, associating project-specific sources with target dataset types through semanticization. Finally, configured operators are assigned to Module Nodes, which define the workspaces where these capabilities will be exposed to end users.

The node graph in MineVis provides a structured authoring representation of application assembly. It records how reusable capabilities, semantic datasets, and deployable workspaces are related at the configuration level. Configurators work with domain-relevant datasets, reusable capability units, and workspace organization, while source adaptation, processing details, event propagation, and view-linking behavior remain encapsulated inside the framework components. This design keeps authoring close to deployment practice: configurators start from visual analytics tasks, choose the capabilities needed for those tasks, and bind the required semantic data to make them operational.

After configuration, MineVis interprets the authored graph into a runtime application. Data Nodes instantiate semantic dataset objects from project sources, and operators consume these dataset instances together with parameters and module-scoped runtime state. Operators produce visual contributions and, when needed, derived semantic datasets for downstream operators. Module Nodes become end-user-facing workspaces, and configured operator capabilities are exposed as functions within those workspaces. End users interact with visual analytics workspaces, functions, visual contributions, legends, controls, and interaction behavior, while the D-O-M graph remains the configurator-facing authoring representation. The next three sections detail the layers introduced here: Section~\ref{sec:data} presents the Data layer, Section~\ref{sec:operator} presents the Operator layer, and Section~\ref{sec:module} presents the Module layer.






\section{Data}
\label{sec:data}

\subsection{Data Design Philosophy}
\label{sec:data-design}

Underground mining visual analytics tasks are rarely supported by a single project source. A roadway temperature analysis may require roadway geometry, sensor identities and mounted positions, and time-indexed environmental readings. A ventilation analysis may combine roadway context, ventilation network structure, and airflow states. Conversely, the same project source may support multiple analysis tasks. A sensor table, for example, may be used for environmental state visualization, warning analysis, trend inspection, or emergency assessment. This many-to-many relation between project sources and visual analytics tasks makes source-centered application construction unstable: visual analytics capabilities become tied to project-specific files, tables, schemas, and service interfaces, which weakens reuse across projects.

MineVis therefore introduces the Data layer as a semantic interface between heterogeneous project sources and reusable visual-analytic operators. Instead of requiring each operator to directly handle project-specific sources, MineVis represents the data required by an operator as semantic datasets with explicit contracts. These contracts define the domain meaning, required roles, and structural expectations of the data input. A dataset should be \emph{independent, coherent, and complete} as a stable input for the visual analytics capabilities that consume it. In this way, operators can be defined against dataset types such as \emph{Roadway}, \emph{Sensor Registry}, \emph{Environmental Sensor Readings}, or \emph{Ventilation Network}, rather than against project-specific source schemas.

This design is supported by three related concepts. \emph{Data Templates} provide a finite developer-facing structural basis for implementing recurring data forms. \emph{Datasets} provide configurator- and operator-facing semantic contracts grounded in these templates. \emph{Data Nodes} operationalize the connection between project sources and datasets by semanticizing heterogeneous inputs into runtime dataset instances. Figure~\ref{fig:data-abstraction-stack} highlights the Data abstraction stack, in which Datasets define semantic contracts grounded in Data Templates, and situates this stack within the broader flow from heterogeneous project sources, through Data Node semanticization, to operator consumption. The following subsections define Data Templates, Datasets, the dataset taxonomy, and Data Node semanticization in detail.

\begin{figure}[htbp]
	\centering
	\includegraphics[width=1.0\linewidth]{imgs/Data-Abstraction-Stack.png}
	\caption{Data abstraction stack in MineVis. The central stack shows how Datasets provide semantic contracts grounded in Data Templates. The surrounding flow illustrates how Data Nodes semanticize heterogeneous project sources into runtime dataset instances consumed by operators.}
	\label{fig:data-abstraction-stack}
\end{figure}


\subsection{Data Templates}
\label{sec:data-templates}

Data Templates provide the finite structural basis of the MineVis data layer. They are not the main vocabulary exposed to configurators during authoring. Instead, they are developer-facing abstractions used to implement reusable dataset contracts. Following the visualization practice of separating structural data forms from domain meaning, MineVis uses templates to capture recurring forms such as geometry, graphs, registries, states, fields, and relations, while leaving underground mining semantics to the Dataset level.

Formally, a Data Template is defined as
\begin{equation}
T=\langle \kappa, A\rangle,
\qquad
A=\{a_i:\mathcal{V}_i^{m_i}\}_{i=1}^{r},
\end{equation}
where $\kappa$ denotes the structural kind of the template, $A$ denotes its attribute schema, $a_i$ is an attribute label, $\mathcal{V}_i$ is the value domain of that attribute, and $m_i$ is a multiplicity qualifier. This definition is intentionally structural rather than semantic: it specifies how data are formed, but not what they mean in underground mining terms. Domain meaning is introduced through dataset contracts in Section~\ref{sec:dataset-abstraction}.

MineVis adopts six top-level templates. \emph{Geometry} represents spatial supports and geometric forms, such as roadway centerlines, sensor positions, geological surfaces, or volume grids. \emph{Graph} represents connectivity and incidence structures, such as roadway networks or ventilation networks. \emph{Registry} represents keyed entity collections, such as sensors, equipment, personnel, or facilities. \emph{State} represents time-indexed observations or conditions, such as sensor readings, airflow states, equipment states, or warning states. \emph{Field} represents values distributed over a support domain, such as gas concentration, geological attributes, or risk values. \emph{Relation} represents explicit correspondences when required by a dataset contract, such as attachment, mapping, grouping, or association among entities or representations.

This template basis keeps the implementation space finite while allowing datasets to be composed flexibly. For example, a \emph{Sensor Registry} dataset may combine Registry and Geometry templates, while a \emph{Ventilation Network} dataset may combine Graph, Registry, and State-related structures under a ventilation semantic contract. Detailed formal definitions and structural notes for all Data Templates are provided in Appendix~\ref{app:data}.

\begin{table}[htbp]
\centering
\caption{Data templates in MineVis.}
\label{tab:data-templates}
\scriptsize
\setlength{\tabcolsep}{2pt}
\renewcommand{\arraystretch}{1.08}
\begin{tabularx}{\columnwidth}{@{}
  >{\raggedright\arraybackslash}p{1.6cm}
  >{\raggedright\arraybackslash}X
@{}}
\toprule
\textbf{Template} & \textbf{Formal definition} \\
\midrule

\mvtemplate{\iconGeom}{Geometry} &
\begin{tabular}[t]{@{}l@{}}
\mvsubtemplate{\iconPoint}{Point}{$\langle pos:\mathbb{R}^3\rangle$} \\
\mvsubtemplate{\iconPolyline}{Polyline}{$\langle vertices:(\mathbb{R}^3)^+\rangle$} \\
\mvsubtemplate{\iconCurve}{Curve}{$\langle curve:I\rightarrow\mathbb{R}^3\rangle$} \\
\mvsubtemplate{\iconMesh}{Mesh}{$\langle vertices:(\mathbb{R}^3)^+,\, faces:(\mathbb{N}^*)^+\rangle$} \\
\mvsubtemplate{\iconSurf}{Surface}{$\langle surface:U\rightarrow\mathbb{R}^3\rangle$} \\
\mvsubtemplate{\iconVol}{Volume}{$\langle domain:\Omega,\, partition:\Pi,\, values:\Pi\rightarrow\mathcal{V}\rangle$}
\end{tabular} \\

\midrule

\mvtemplate{\iconGraph}{Graph} &
$\langle nodes:N,\, edges:E,\, incidence:E\rightarrow N\times N\rangle$ \\

\mvtemplate{\iconReg}{Registry} &
$\langle key:K,\, attrs:A\rangle$ \\

\mvtemplate{\iconState}{State} &
$\langle subject:K,\, time:\mathbb{T},\, attrs:A\rangle$ \\

\mvtemplate{\iconField}{Field} &
$\langle support:S,\, values:S\rightarrow\mathcal{V}\rangle$ \\

\mvtemplate{\iconRel}{Relation} &
$\langle source:K_s,\, target:K_t,\, attrs:A\rangle$ \\

\bottomrule
\end{tabularx}
\end{table}

\subsection{Dataset Abstraction}
\label{sec:dataset-abstraction}

In MineVis authoring, operators declare their data requirements in terms of semantic datasets. After selecting an operator for a visual analytics task, the configurator satisfies these requirements by creating, selecting, or binding Data Nodes. A dataset therefore acts as the semantic input contract between project-specific sources and reusable visual-analytic operators. MineVis defines a dataset as a semantic data abstraction that couples a domain contract with structural grounding:
\begin{equation}
\mathcal{D}=\langle \Sigma,\Delta\rangle ,
\end{equation}
where $\Sigma$ is a semantic contract and $\Delta$ is a finite set of Data Templates. The contract $\Sigma$ specifies what the data mean and how they can be used by operators, while $\Delta$ provides the structural grounding needed for implementation.

The semantic contract of a dataset is defined as
\begin{equation}
\Sigma=\langle c,\rho,\Gamma\rangle .
\end{equation}
Here, $c$ denotes the dataset's domain class, such as \emph{Roadway}, \emph{Sensor Registry}, \emph{Ventilation Network}, or \emph{Roadway Hazard State}. The term $\rho$ assigns the templates in $\Delta$ to the domain roles required by class $c$. The term $\Gamma$ denotes validity constraints over these assigned roles, such as required roles, identifier consistency, spatial validity, topology validity, or domain-specific value constraints. For example, in a \emph{Sensor Registry} dataset, $c$ identifies the dataset as a sensor registry, $\rho$ may assign a registry template to the sensor identity role and a geometry template to the mounted-position role, and $\Gamma$ may require unique sensor identifiers, required sensor-type attributes, and a valid mounted position for each registered sensor.

The boundary of a dataset operationalizes the principle introduced in Section~\ref{sec:data-design}: a dataset should be independent, coherent, and complete as an operator input. MineVis applies this principle through three criteria. First, \emph{capability-oriented completeness} means that a dataset should contain the semantic roles required by the operators that consume it; completeness is defined with respect to a visual analytics capability, not with respect to all possible information about a mining entity. For example, a \emph{Roadway Hazard State} used by emergency analysis should include affected roadway regions, risk levels, and passability states, but it does not need to contain personnel identities or emergency resources. Second, \emph{semantic coherence} means that the roles in a dataset should describe a coherent set of mining entities, states, or relations, rather than an arbitrary bundle of sources that happen to be stored together. For example, a \emph{Ventilation Network} dataset may contain branches, nodes, and ventilation facilities because they jointly define an air circulation structure, whereas production logs should not be included merely because they are stored in the same project database. Third, \emph{analytic-role separation} means that data with substantially different analysis roles should remain separate, even when they are related by identifiers or used together in the same workspace. For example, \emph{Sensor Registry} and \emph{Environmental Sensor Readings} are separated: the former defines sensor identity and mounting context, while the latter provides time-indexed observations consumed by monitoring and trend operators. These criteria keep datasets meaningful as reusable operator inputs while avoiding both over-fragmented source handling and overly broad project-specific data bundles.

For configurators, the dataset abstraction turns heterogeneous source arrangements into stable semantic inputs. Configurators select and instantiate datasets such as \emph{Roadway}, \emph{Ventilation Network}, \emph{Geological Body}, or \emph{Roadway Hazard State}, instead of assembling project-specific source fragments for each operator. For developers, the same abstraction allows operators to be defined against dataset contracts rather than against project-specific schemas. The next section organizes these dataset contracts into a domain-grounded taxonomy for underground mining.


\subsection{Dataset Taxonomy for Underground Mining}
\label{sec:dataset-taxonomy}

Having defined datasets as semantic input contracts, we organize recurring underground mining datasets into a domain-grounded taxonomy. The taxonomy classifies dataset contracts used by visual-analytic operators, rather than project source formats, database schemas, or internal Data Templates. It was derived from recurring dataset requirements observed during the design-study process and deployments D1--D8. The taxonomy helps configurators select meaningful dataset inputs, helps developers organize reusable dataset contracts and Data Node adapters, and provides the data-side basis for the coverage analysis in Section~\ref{sec:evaluation-coverage}.

The taxonomy is organized by the domain focus and visual analytics role of semantic datasets. MineVis currently uses eight top-level classes: \emph{Roadways \& Infrastructure}, \emph{Geology \& Resources}, \emph{Monitoring \& Sensing}, \emph{Production \& Operations}, \emph{Ventilation}, \emph{People \& Vehicles}, \emph{Robots \& Equipment}, and \emph{Safety \& Emergency}. These classes are not Data Template types. Datasets in different classes may share templates, and one dataset may combine multiple templates under a semantic contract. Table~\ref{tab:dataset-taxonomy} summarizes the taxonomy with representative datasets and their typical visual analytics roles.


\newlength{\taxIconH}
\setlength{\taxIconH}{0.75em}

\newlength{\taxIconBoxW}
\setlength{\taxIconBoxW}{1.15em}

\newlength{\taxIconGap}
\setlength{\taxIconGap}{0.35em}

\newcommand{\taxicon}[1]{%
  \raisebox{-0.08em}{%
    \makebox[\taxIconBoxW][c]{%
      \resizebox{!}{\taxIconH}{#1}%
    }%
  }%
}

\newcommand{\taxclass}[2]{\taxicon{#1}\hspace{\taxIconGap}#2}

\begin{table*}[t]
\centering
\caption{Top-level dataset taxonomy in MineVis. The taxonomy organizes semantic dataset contracts for underground mining visual analytics rather than raw source formats or internal Data Template types.}
\label{tab:dataset-taxonomy}
\scriptsize
\setlength{\tabcolsep}{4pt}
\renewcommand{\arraystretch}{1.08}
\begin{tabularx}{\textwidth}{@{} 
    >{\raggedright\arraybackslash\hsize=0.70\hsize}X
    >{\raggedright\arraybackslash\hsize=1.15\hsize}X
    >{\raggedright\arraybackslash\hsize=1.15\hsize}X
    @{}}
\toprule
\textbf{Top-level class} & \textbf{Representative datasets} & \textbf{Visual analytics role} \\
\midrule

\taxclass{\iconRoad}{Roadways \& Infrastructure} &
Roadway, Support Structure, Underground Facility, Infrastructure State &
Spatial context, localization, topology, and route reference \\

\addlinespace

\taxclass{\iconGeo}{Geology \& Resources} &
Geological Body, Borehole, Geological Structure, Geological Attribute Model &
Geological interpretation, section analysis, and resource-context inspection \\

\addlinespace

\taxclass{\iconMon}{Monitoring \& Sensing} &
Sensor Registry, Environmental Sensor Readings, Monitoring Field, Warning State &
State monitoring, warning display, and temporal trend inspection \\

\addlinespace

\taxclass{\iconProd}{Production \& Operations} &
Working Face, Production Unit, Operation State, Process Record &
Production-process visualization and operational state analysis \\

\addlinespace

\taxclass{\iconVent}{Ventilation} &
Ventilation Network, Airflow State, Ventilation Facility &
Network flow inspection, airflow comparison, and anomaly analysis \\

\addlinespace

\taxclass{\iconPeople}{People \& Vehicles} &
People, Personnel Registry, Mobility Trace, Vehicle State &
Presence, mobility, route, and safety-context analysis \\

\addlinespace

\taxclass{\iconRobot}{Robots \& Equipment} &
Robot Kinematic Model, Motion Trajectory, Equipment Operation State &
Kinematic visualization, motion simulation, trajectory inspection, and equipment status analysis \\

\addlinespace

\taxclass{\iconSafe}{Safety \& Emergency} &
Hazard Source, Roadway Hazard State, Hazard Region, Emergency Resource &
Hazard overlay, risk propagation, and emergency response analysis \\

\bottomrule
\end{tabularx}
\vspace{-4mm}
\end{table*}

The taxonomy is extensible rather than exhaustive. New datasets can be added when new visual analytics tasks or project data requirements appear, but each extension should define a meaningful domain class, specify the required semantic roles and constraints, and be grounded in the finite Data Template basis. In this way, the taxonomy provides a stable organization for dataset reuse without constraining MineVis to a closed list of mining data types.

\subsection{Data Node Semanticization}
\label{sec:data-node-semanticization}

The dataset taxonomy defines the semantic data space exposed by MineVis, but real project data still arrive as heterogeneous sources such as tables, logs, models, drawings, network descriptions, simulation outputs, databases, and service interfaces. A Data Node bridges this gap by representing the authoring configuration for a target dataset type. In the D-O-M graph, a Data Node is created or selected to satisfy a dataset requirement declared by an operator. It does not simply import a source; it specifies how project-specific sources should be interpreted under a dataset contract so that the resulting data can be consumed consistently by operators.

Semanticization is both a data construction mechanism and an authoring interaction. Given a target dataset type, the Data Node exposes the roles and constraints required by the corresponding semantic contract. The configurator binds project sources to these roles, configures field or structure mappings, and checks whether the bound sources satisfy the required constraints. For example, a \emph{Sensor Registry} Data Node may require sensor identifiers, sensor types, and mounted positions; a \emph{Ventilation Network} Data Node may require branches, nodes, and facility attributes; a \emph{Roadway Hazard State} Data Node may be bound to simulation outputs that encode affected roadway regions, risk levels, and passability states. During runtime, the validated Data Node materializes a dataset instance, which becomes the semantic input consumed by operators.

This mechanism also defines the boundary of reuse and extension in the Data layer. Common source formats, recurring dataset contracts, and frequent role mappings can be packaged into reusable Data Node libraries, reducing repeated configuration effort across projects. Configurators still need to bind sources, inspect mappings, and verify constraints, especially when project data are incomplete, inconsistent, or organized according to local conventions. Uncommon enterprise-specific formats may require developer-side adapters, and newly identified data requirements may require developers to define new dataset contracts by composing Data Templates and specifying roles and constraints. These extensions do not change the configurator's authoring model: operators continue to request semantic datasets, Data Nodes continue to satisfy those requests, and source-specific complexity remains separated from reusable visual-analytic operators.

\section{Operator}
\label{sec:operator}


\subsection{Operator Design Philosophy}
\label{sec:operator-design-philosophy}

The Data layer introduced in Section~\ref{sec:data} provides stable semantic dataset contracts for heterogeneous mining data. The next question is how recurring visualization and analysis capabilities can be made reusable over these datasets. Across the design-study process, we repeatedly observed visual analytics needs such as spatial mapping, temporal trend inspection, network reasoning, field overlay, route analysis, geological sectioning, scenario exploration, and hazard evolution analysis. In conventional project-specific systems, these capabilities are often embedded in individual pages, workflows, or delivery-specific implementations. As a result, similar visual analytics needs must be reimplemented when the project schema, task emphasis, or deployment context changes.

MineVis addresses this problem by introducing \emph{operators} as reusable visual-analytic capability units. The design of operators is centered on the configurator's mental model. A configurator typically starts from a visual analytics requirement: inspecting a distribution, comparing time-varying states, analyzing a network, exploring a simulated scenario, or presenting a domain-specific view to end users. The configurator should therefore be able to select a capability at this level of intent, bind the required semantic datasets, and adjust a limited set of parameters. This differs from low-level flow authoring, where the assembler must construct a chain of data transformations, algorithms, event propagation rules, and view-linking logic. MineVis places such implementation details inside reusable operators and exposes operators as domain-relevant capability blocks.

This perspective also defines the intended granularity of an operator. An operator should not be a low-level primitive such as a filter, join, event handler, or rendering command, because such primitives shift implementation reasoning to the configurator. At the same time, an operator should not be an entire project-specific page or a fixed business subsystem, because such coarse units are difficult to reuse and recombine. The appropriate granularity is a visual analytics capability that has a recognizable intent, declares stable dataset requirements, exposes meaningful parameters, contributes interpretable visual outputs, and can participate in module-level organization. For example, roadway scalar analysis, branch airflow trend inspection, geological section analysis, and hazard simulation are suitable operator-level capabilities because they are recognizable to configurators, reusable across projects, and configurable over semantic datasets. By contrast, a color-scale interpolation step is too low-level, while a complete environmental monitoring page is too project-specific.

An operator in MineVis is therefore defined over semantic datasets rather than raw project sources. It declares the dataset types it requires, carries parameters, encapsulates the processing needed for a visual analytics intent, and contributes visual and interactive results to a workspace. Some operators may also produce derived semantic datasets for downstream operators. This allows one capability to be reused across related tasks. For example, roadway scalar analysis can support temperature, gas concentration, humidity, or other environmental variables once the required roadway, sensor registry, and sensor reading datasets are available. Similarly, ventilation inspection, branch trend analysis, geological sectioning, and hazard simulation can be configured over their declared dataset requirements instead of being rebuilt as isolated project functions.

This design supports the role decoupling that motivates MineVis. Developers implement and extend operator libraries; configurators select, parameterize, and compose operators according to project requirements; end users interact with the resulting functions and workspaces rather than with operator internals. Operators thus serve as the middle layer of the D-O-M architecture. Data provides semantic inputs, Operators provide reusable visual analytics capabilities, and Modules organize configured operators into end-user-facing workspaces and functions. The following subsection formalizes the operator abstraction, and Section~\ref{sec:operator-taxonomy} organizes representative operators according to the primary visual analytics operations they support.


\subsection{Formal Definition of Operators}
\label{sec:formal-operator-definition}

To make the operator abstraction explicit, MineVis defines an operator as
\begin{equation}
\mathcal{O}=\langle \mathcal{D}_{in}, P, C, \Phi, V, \mathcal{I}, \mathcal{D}_{out}\rangle ,
\end{equation}
where $\mathcal{D}_{in}$ denotes input dataset requirements, $P$ denotes parameters, $C$ denotes the context interface, $\Phi$ denotes the processing core, $V$ denotes visual contributions, $\mathcal{I}$ denotes interaction, and $\mathcal{D}_{out}$ denotes optional output datasets. Figure~\ref{fig:operator-model} summarizes these components and their relations. The tuple describes an operator by the semantic datasets it requires, the parameters and context that influence its behavior, the visual analytics processing it encapsulates, the workspace contributions it produces, and the semantic outputs it may provide for downstream operators.

\begin{figure}[htbp]
	\centering
	\includegraphics[width=1.0\linewidth]{imgs/operator.png}
	\caption{Formal structure of a MineVis operator. Blue arrows denote semantic dataset flow from input dataset requirements to optional output datasets. Visual contributions are sent to the Module layer, while context and interaction provide coordination and runtime update channels. Dashed arrows indicate optional runtime update influences.}
	\label{fig:operator-model}
\end{figure}

The components $\mathcal{D}_{in}$ and $P$ define the input and parameter interface of an operator. The component $\mathcal{D}_{in}$ declares the semantic dataset types required by the operator, such as \emph{Roadway}, \emph{Sensor Registry}, \emph{Ventilation Network}, \emph{Airflow State}, or \emph{Roadway Hazard State}. These requirements are declared at the dataset level introduced in Section~\ref{sec:dataset-abstraction}, so the same operator can be reused across projects once compatible Data Nodes instantiate the required datasets. The component $P$ denotes the operator's parameters, including default values, configurator-exposed settings, and runtime-updated parameter states. Examples include active variables, thresholds, aggregation windows, visual mappings, time ranges, filtering settings, and scenario parameters. Only a subset of $P$ is necessarily exposed to configurators; other parameters may be internal defaults or values updated by interaction or module-scoped context.

The component $C$ defines the context interface through which an operator participates in module-level coordination. Context may include shared time, selected entities, active variables, spatial focus, camera state, or scenario state. Unlike parameters, which belong to an operator's local state, context is scoped by the Module layer and can be shared among functions within the same workspace. An operator may publish context, subscribe to context, or do both. Subscribed context can influence the processing core directly, and in some operators it may also synchronize selected parameters. For example, a roadway coloring operator and a sensor trend operator may both respond to the same selected sensor and current time. The operator declares its context interface, while the Module layer coordinates compatible context among active functions.

The component $\Phi$ represents the processing core of an operator. It transforms the required datasets, parameters, and relevant context into results used for visualization, interaction, or downstream reuse. Depending on the operator, $\Phi$ may involve spatial mapping, aggregation, filtering, interpolation, network reasoning, temporal slicing, route computation, or simulation. Configurators select an operator according to its visual analytics capability and adjust the parameters that are exposed for configuration. The internal implementation of $\Phi$ remains part of the reusable operator definition.

The components $V$ and $\mathcal{I}$ define how an operator becomes visible and interactive in a workspace. The component $V$ specifies the operator's visual contributions, including three dimensional overlays, glyphs, analytic charts, topology views, legends, labels, controls, explanatory panels, or annotations. The component $\mathcal{I}$ denotes interaction, namely the behavior through which these visual contributions respond to user actions, parameter changes, and module-scoped context. Interaction may update local visual state, modify parameters, or publish context such as selection, focus, or time. Thus, $V$ specifies what the operator contributes to the workspace, while $\mathcal{I}$ specifies how those contributions behave during visual analysis. Most interaction behavior is provided as part of the operator implementation; when adjustment is needed, it is exposed through ordinary parameters in $P$.

The component $\mathcal{D}_{out}$ specifies optional semantic dataset outputs produced by an operator. Many operators only contribute visual results, but some produce derived datasets that can be consumed by downstream operators. Examples include a filtered subnetwork, an interpolated field, a selected route, or a simulation-derived hazard state. These outputs remain semantic datasets governed by the dataset abstraction in Section~\ref{sec:dataset-abstraction}. This keeps operator composition at the level of meaningful dataset contracts and provides the basis for dataset closure in the Module layer.

The tuple also defines how operators connect to module-level organization. The context interface $C$ supports shared runtime state; $V$ and $\mathcal{I}$ provide visual contributions and interaction behavior for workspaces; and $\mathcal{D}_{out}$ supports downstream composition through semantic datasets. The Module layer builds on these interfaces to expose configured operators as functions, coordinate their visual contributions, and manage their lifecycle. The next section organizes operators according to the primary visual analytics operations they support. 


\subsection{Operator Taxonomy}
\label{sec:operator-taxonomy}

The formal definition in Section~\ref{sec:formal-operator-definition} specifies the structure of an operator, while the taxonomy organizes the reusable capability space exposed by the Operator layer. In MineVis, the primary organizing axis is the dominant visual analytics operation supported by an operator. This axis was chosen because it summarizes what the operator helps users analyze, and because it provides a stable basis for both configurator-side capability selection and developer-side operator extension. A concrete operator may involve spatial, topological, temporal, and scenario-related aspects at the same time. Its primary class is assigned according to the main analytical question it is designed to support. MineVis uses four primary classes: \emph{Spatial}, \emph{Topological}, \emph{Temporal}, and \emph{Simulation}.

\emph{Spatial operators} are centered on spatial distribution, geometric support, and location-based interpretation. They support questions such as where a value is distributed, how a field relates to geometry, or how geological and roadway structures intersect. Typical capabilities include spatial mapping, field representation, geometry inspection, section analysis, and spatial relation exploration. \emph{Topological operators} are centered on connectivity, reachability, routing, and network-constrained reasoning. They support questions about how entities are connected, how flows or hazards propagate through a network, and which paths or subnetworks are relevant. \emph{Temporal operators} are centered on recorded or observed time-indexed states. They support trend inspection, time slicing, interval comparison, state replay, and time-varying pattern analysis. \emph{Simulation operators} are centered on scenario generation and what-if exploration. Although their outputs may also be time-indexed, their primary purpose is prospective analysis: exploring how a hazard, airflow condition, evacuation process, or other scenario may evolve under current or hypothetical conditions.
Table~\ref{tab:operator-taxonomy} summarizes the four primary classes with representative visual-analytic capabilities and operators.

\begin{table*}[htbp]
\centering
\caption{Operator taxonomy in MineVis. The table summarizes four primary visual analytics emphases used to organize reusable operator capabilities and representative operators.}
\label{tab:operator-taxonomy}
\scriptsize 
\begin{tabularx}{\textwidth}{@{} 
    >{\raggedright\arraybackslash}p{1.6cm}
    >{\raggedright\arraybackslash}X 
    >{\raggedright\arraybackslash}X
    @{}}
\toprule
\textbf{Primary class} & \textbf{Representative visual-analytic capabilities} & \textbf{Representative operators} \\
\midrule
Spatial &
Spatial mapping, field representation, geometry inspection, section analysis, spatial relation exploration &
Roadway Scalar Mapping; Geological Section Analysis; Geological Attribute Distribution Analysis; Roadway--Geology Relation Exploration \\
\addlinespace
Topological &
Network overview, connectivity inspection, route and reachability analysis, subnetwork extraction, network-constrained propagation &
Ventilation Network Overview; Airflow Distribution Analysis; Route and Reachability Analysis; Subnetwork Extraction \\
\addlinespace
Temporal &
Trend inspection, time slicing, interval comparison, state replay, time-varying pattern analysis &
Sensor Trend Inspection; Branch Airflow Trend Analysis; Mobility Trace Analysis; Production State Timeline Analysis \\
\addlinespace
Simulation &
Scenario evolution, what-if comparison, hazard propagation, response analysis, parameterized scenario exploration &
Water-Inrush Scenario Simulation; Fire-and-Smoke Propagation Analysis; Hazard Evolution Analysis; Emergency Response Analysis \\
\bottomrule
\end{tabularx}
\end{table*}

The primary class keeps the operator library compact and interpretable, while lightweight task-family tags support project-oriented search and filtering. For example, an operator may be tagged as commonly used in environmental state analysis, ventilation and airflow analysis, hazard response, geology interpretation, personnel mobility, or robot operation. These tags help configurators locate relevant operators for a visual analytics task, but they do not define the primary taxonomy. New operators can be added as new visual analytics requirements appear, but they should still follow the operator definition in Section~\ref{sec:formal-operator-definition}: they should declare semantic dataset requirements, provide meaningful parameters, contribute interpretable visual and interactive workspace elements, and, when appropriate, produce semantic datasets for downstream composition. The next section explains how configured operators are exposed as functions and coordinated within end-user-facing workspaces.

\section{Module} 
\label{sec:module}



\subsection{Module Definition and Design Philosophy}
\label{sec:module-design}

The Data and Operator layers provide semantic inputs and reusable visual-analytic capabilities, but they are not the units through which end users experience a MineVis application. The D-O-M graph is a configurator-facing authoring representation. End users interact with workspaces, functions, and visual contributions rather than with Data Nodes, Operator Nodes, or operator dependency graphs. The Module layer provides this translation from authoring structure to runtime application structure.

A \emph{module} in MineVis is a composition and coordination scope for configured operators. In the authoring graph, it appears as a \emph{Module Node} that receives operators selected by the configurator. At runtime, the same module is presented as an end-user-facing \emph{workspace}. A workspace organizes related functions, visual contributions, controls, legends, and interaction behavior for a visual analytics task, such as environmental state analysis, ventilation and airflow analysis, emergency response, or geology interpretation. This dual identity allows the same structure to support both configurator-side assembly and end-user-side use.

Within a workspace, a \emph{function} is the capability unit exposed to end users. A function is grounded in one or more operators, but it is not an additional node type in the D-O-M authoring graph. In the common case, a function corresponds to a single operator connected to the Module Node. In more complex cases, a function may depend on a small upstream operator chain, especially when an upstream operator produces a derived dataset required by a downstream operator. The end user sees the resulting function, while the internal operator structure remains part of the configurator-facing authoring model. The detailed derivation of functions from operator graphs is discussed in Section~\ref{sec:module-coordination}.

This separation keeps the responsibilities of the three D-O-M layers distinct. Data Nodes construct semantic dataset instances, Operator Nodes provide reusable visual-analytic capabilities, and Module Nodes organize configured capabilities into runtime workspaces and functions. As a result, configurators can assemble applications through a structured authoring graph, while end users work with task-oriented visual analytics workspaces. The next section explains how functions within a module coordinate through shared context, coordinated visual contributions, and dataset-level closure.



\subsection{Intra-module Coordination}
\label{sec:module-coordination}

A module provides the primary coordination scope in MineVis. Within a workspace, multiple functions may be active at the same time, and some functions may depend on small upstream operator chains. MineVis organizes such cooperation through three coordination mechanisms: shared context, coordinated visual contributions, and dataset closure. These mechanisms build on the operator interfaces introduced in Section~\ref{sec:formal-operator-definition}, but their coordination semantics are defined at the Module layer. Figure~\ref{fig:module-coordination} summarizes the three mechanisms.

\begin{figure}[htbp]
    \centering
    \includegraphics[width=1.0\linewidth]{imgs/coordinations.png}
    \caption{Intra-module coordination in MineVis. Shared context synchronizes module-scoped runtime state; coordinated visual contributions organize visible artifacts into a coherent workspace; dataset closure allows derived semantic datasets to support downstream operators and function composition.}
    \label{fig:module-coordination}
\end{figure}

\noindent\textbf{Shared context.}
Shared context coordinates runtime state within a module. It represents module-scoped information such as current time, selected entity, active variable, spatial focus, camera state, or scenario state. Operators that implement workspace functions participate through their context interface \(C\), declaring which context values they can publish or consume. The module maintains compatible context values and propagates them among active functions. For configurators, this mechanism is default: when functions with matching context interfaces are placed in the same module, MineVis enables sharing without requiring event-channel authoring. For end users, shared context appears as synchronized interaction. For example, in an environmental monitoring workspace, selecting a sensor in the roadway scene updates the selected-sensor context, and the trend inspection function uses the same context to show the corresponding time series.

\noindent\textbf{Coordinated visual contributions.}
Coordinated visual contributions organize the visible outputs of active functions into a coherent analytic workspace. The mechanism operates on the visual contributions \(V\) and interaction behavior \(\mathcal{I}\) provided by operators. MineVis organizes these contributions through recurring workspace relations, including semantic consistency, role complementarity, focus response, and control--display coupling. Semantic consistency keeps encodings and identity cues compatible across views; role complementarity assigns contributions to roles such as overview, detail, control, and explanation; focus response allows one contribution to guide another; and control--display coupling links controls, legends, or annotations to the displays they govern. For configurators, this coordination is also mostly default: operators provide default contribution roles and coordination behavior, while configurators may only refine lightweight options such as visibility, layout priority, or whether selected upstream contributions are exposed. For end users, the result is a workspace in which multiple visual artifacts work together. In a ventilation workspace, a network overview, a three dimensional airflow overlay, branch trend charts, legends, and variable controls are presented as complementary parts of one visual analytics workspace. Shared context coordinates runtime state; coordinated visual contributions coordinate visible workspace roles and relations, although some focus-response behavior may use shared context.

\noindent\textbf{Dataset closure and function composition.}
Dataset closure coordinates operators through semantic output datasets. An operator may produce an output dataset \(\mathcal{D}_{out}\), which can satisfy the input dataset requirement of a downstream operator. Because the exchanged object remains a semantic dataset, composition occurs at the level of dataset contracts rather than low-level intermediate data. For configurators, this means that operator chains can be assembled through dataset compatibility while preserving the high-level D-O-M authoring model. When an operator directly connected to a Module Node depends on upstream operators, the directly connected operator acts as the root of the exposed function, and upstream operators serve as dependencies. The root operator determines the function's default identity and public visual contributions. Upstream operators provide required processing or derived datasets, and their visual contributions remain hidden by default unless explicitly exposed by the configurator. For end users, the operator chain appears as one coherent function. In an emergency response workspace, a water-inrush simulation can produce a \emph{Roadway Hazard State} dataset that is consumed by personnel emergency analysis to derive risk states, evacuation routes, and response suggestions.

These mechanisms allow a module to turn configured operators into coherent workspace functions. Shared context keeps state consistent, coordinated visual contributions structure the visible analytic workspace, and dataset closure supports multi-operator function composition. The next section describes how the visual contributions produced by active functions are managed over time, including visibility control, interaction locking, and pinning.


\subsection{Visual Contribution Lifecycle}
\label{sec:module-visual-lifecycle}

When multiple functions are enabled in the same workspace, their visual contributions may coexist in the three dimensional scene, in floating analytic panels, and in auxiliary interface elements such as legends, controls, and annotations. MineVis therefore treats visual contributions as runtime artifacts that can be managed at the module level. A visual contribution manager lists the currently available artifacts produced by active functions and provides a small set of lightweight controls, such as show or hide, opacity adjustment, layer order, focus or locate, interaction lock, legend or detail expansion, and pin or unpin. These controls are deliberately limited. They help users manage how visible artifacts coexist in the workspace, especially when multiple three dimensional overlays or analytic panels are active, but they do not expose the internal operator graph or low-level interaction rules. In this sense, visual contribution management is artifact management rather than operator programming.

Pinning provides a simple weak coordination mechanism across workspaces. When a visual contribution is pinned, MineVis converts it into a frozen visual reference that can persist after its source function is disabled or after the user switches to another workspace. By default, a pinned contribution does not continue to follow the shared context of its original module; it preserves the visual state at the moment of pinning, including its encoding, selected objects, and relevant parameter settings. This design avoids unpredictable live coupling between workspaces while still allowing users to carry useful visual evidence across module boundaries. For example, a user may pin a simulated hazard region in the Emergency Response Workspace and then switch to the Ventilation Analysis Workspace to compare the frozen hazard reference with airflow patterns. The pinned artifact acts as a cross-workspace visual reference, not as a live inter-module synchronization channel.



\section{Case Studies}
\label{sec:case-studies}

\subsection{Case Study Overview}
\label{sec:case-overview}

We present four representative case studies to illustrate how MineVis instantiates the D-O-M abstractions for recurring underground mining visual analytics tasks. The cases were selected to cover different dataset categories, operator classes, and module-level coordination mechanisms. They are not intended to enumerate the full application space of MineVis; instead, they provide concrete examples of how semantic datasets, reusable operators, and modules work together to produce end-user-facing visual analytics workspaces.

The four cases cover environmental state analysis, ventilation and airflow analysis, hazard simulation and response, and geology interpretation. These tasks require different combinations of spatial, topological, temporal, and simulation-oriented capabilities. They also exercise the module mechanisms introduced in Section~\ref{sec:module}, including shared context, coordinated visual contributions, dataset closure, and visual contribution lifecycle management.

Figure~\ref{fig:case-montage} summarizes the four case studies. Each panel shows the D-O-M authoring configuration on the top and the corresponding runtime workspace on the bottom. This layout makes the relationship between configurator-side assembly and end-user-facing visual analytics workspaces explicit.

\begin{figure*}[t]
    \centering
    \includegraphics[width=\textwidth]{imgs/case_study_montage.png}
    \caption{Representative MineVis case studies. Each panel shows the D-O-M authoring configuration on the top and the corresponding runtime workspace on the bottom. 
    (a) Environmental Monitoring maps environmental sensor readings to roadway scalar states and supports sensor trend inspection. 
    (b) Ventilation Analysis combines ventilation network overview, airflow distribution, branch trend inspection, and anomaly highlighting. 
    (c) Emergency Response uses simulation operators to generate roadway hazard states for personnel risk and safe-route analysis. 
    (d) Geological Analysis supports geological overview, section analysis, borehole correlation, attribute distribution, and roadway--geology relationship exploration.}
    \label{fig:case-montage}
\end{figure*}


\subsection{Environmental Monitoring Workspace}
\label{sec:case-monitoring}

The environmental monitoring case focuses on roadway-level state inspection from heterogeneous sensing data. The workspace supports visual analysis of environmental variables such as temperature, gas concentration, and humidity by combining spatial context with sensor observations. In the D-O-M configuration, the main datasets include \emph{Roadway}, \emph{Sensor Registry}, and \emph{Environmental Sensor Readings}. The configurator selects roadway scalar mapping and sensor trend inspection operators, binds them to the required datasets, and assigns the configured operators to an environmental monitoring module. Different monitoring variables can be configured as parameterized instances of the same scalar-mapping capability, which avoids treating each variable as a separate project-specific function.

At runtime, the workspace presents environmental states as visual contributions in the roadway scene and links them with sensor-level temporal trends. End users can inspect the spatial distribution of a selected variable, identify abnormal roadway regions or sensor readings, and compare local states with historical trends. Shared context keeps the selected sensor, active variable, and time range consistent across the spatial view and trend inspection function. This case shows how operator reuse and shared context support multiple environmental monitoring functions within one visual analytics workspace.


\subsection{Ventilation Analysis Workspace}
\label{sec:case-ventilation}

The ventilation case addresses airflow interpretation over a roadway-constrained network. Ventilation analysis requires users to understand network connectivity, spatial location, airflow direction, branch-level state, and temporal variation together. In the D-O-M configuration, the main datasets include \emph{Roadway}, \emph{Ventilation Network}, and \emph{Airflow State}. The configurator selects operators for ventilation network overview, airflow distribution analysis, branch airflow trend inspection, and anomaly highlighting, and assigns them to a ventilation analysis module.

At runtime, the workspace organizes these operators as coordinated visual contributions. The network overview provides a topology-oriented representation of branches and facilities, while the three dimensional airflow overlay places airflow states in the roadway scene. Branch trend charts support temporal inspection, and legends or variable controls maintain consistent interpretation of airflow volume, velocity, direction, or abnormal state. Shared selection and active-variable context connect the network, spatial overlay, and trend inspection functions, while coordinated visual contributions organize them as complementary overview, detail, temporal, and control elements. This case demonstrates how MineVis combines topological, spatial, and temporal visual analytics capabilities into one coherent ventilation analysis workspace.



\subsection{Emergency Response Workspace}
\label{sec:case-emergency}

The emergency response case illustrates how simulation-derived states can become semantic inputs for downstream visual analysis. The workspace supports scenario exploration for hazards such as water inrush by connecting hazard evolution with personnel risk and route analysis. In the D-O-M configuration, the main datasets include \emph{Roadway}, \emph{People}, \emph{Emergency Resource}, \emph{Hazard Source}, and the derived \emph{Roadway Hazard State}. The configurator selects a water-inrush scenario simulation operator and connects its output to personnel emergency analysis and safe-route analysis operators within an emergency response module.

At runtime, the workspace presents hazard evolution, affected roadway regions, exposed personnel, available emergency resources, and recommended routes as coordinated visual contributions. End users can inspect how a simulated hazard propagates through the roadway space, identify personnel or regions at risk, and compare response alternatives. The key mechanism illustrated by this case is dataset closure: the simulation operator does not only produce a visual animation or transient layer, but materializes a semantic \emph{Roadway Hazard State} dataset that can be consumed by downstream operators. This allows emergency response analysis to be configured as a multi-operator function while remaining understandable to end users as one coherent visual analytics workflow.


\subsection{Geological Analysis Workspace}
\label{sec:case-geology}

The geological analysis case extends MineVis from operational monitoring to spatial interpretation of geological structures and attributes. Geological visual analytics requires users to relate three dimensional geological bodies, boreholes, structural features, attribute distributions, and roadway positions. In the D-O-M configuration, the main datasets include \emph{Geological Body}, \emph{Borehole}, \emph{Geological Structure}, \emph{Geological Attribute Model}, and \emph{Roadway}. The configurator selects operators for geological overview, section analysis, borehole correlation, attribute distribution analysis, and roadway--geology relation exploration, and assigns them to a geological analysis module.

At runtime, the workspace supports interpretation across multiple spatial representations. End users can inspect geological bodies in three dimensions, cut sections through selected regions, compare borehole information, examine attribute distributions, and relate roadway layouts to geological context. These visual contributions provide complementary views for spatial reasoning rather than isolated displays. This case shows that the D-O-M abstractions can support interpretive visual analysis over geological data, extending MineVis beyond monitoring-centered operational workspaces.