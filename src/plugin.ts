import {
  Compiler,
  Compilation,
  optimize,
  container,
  WebpackError,
} from "webpack";
const { ModuleFederationPlugin } = container;

type PackageJson = {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
} & Record<string, any>;

type ModuleFederationConfig = ConstructorParameters<
  typeof ModuleFederationPlugin
>[0];

type IReactWebpackModuleFederationPluginOptions = {
  port: number;
  container?: boolean;
  /**
   * @default remoteEntry
   */
  remoteEntryFilename?: string;
  /**
   * @default '["react", "react-dom", "react-router-dom", "react-intl"]'
   */
  includeSingletons?: string[];
  excludeSingletons?: string[];

  moduleFederationConfig?: Partial<ModuleFederationConfig>;
};

export default class ReactWebpackModuleFederationPlugin extends optimize.ModuleConcatenationPlugin {
  public readonly name = "ReactWebpackModuleFederationPlugin";

  protected packageJson: PackageJson | undefined = undefined;

  constructor(public options: IReactWebpackModuleFederationPluginOptions) {
    super(options);
  }

  setPackageJson(compilation: Compilation) {
    const packagePath = `${process.cwd()}/package.json`;
    try {
      this.packageJson = require(packagePath);
    } catch (e) {
      compilation.errors.push(
        new WebpackError(`Failed to require config file at "${packagePath}"`)
      );
    }
  }
  get safeName() {
    return cleanText(this.packageJson!.name);
  }

  get port() {
    return this.options.port;
  }
  get env() {
    return process.env.NODE_ENV;
  }
  get isContainer() {
    return this.options.container ?? false;
  }
  get remoteEntryFilename() {
    return this.options.remoteEntryFilename ?? "remoteEntry";
  }

  get output() {
    return this.env === "production"
      ? {
          filename: "[name].[contenthash].js",
          publicPath: "auto",
        }
      : {
          publicPath: `http://localhost:${this.port}/`,
        };
  }

  get remoteEntries() {
    const entries =
      this.env === "production"
        ? this.packageJson?.remoteEntries
        : this.packageJson?.devRemoteEntries;

    return Object.entries(entries).reduce((prev, [name, path]) => {
      const cleanName = cleanText(name);
      return {
        ...prev,
        [name]: `promise new Promise((resolve,reject)=>{
				const url = '${path}/${this.remoteEntryFilename}.js';
				const script = document.createElement('script');
				script.src=url;
				script.onerror = ()=>{
					const proxy = {
						get:()=>{},
						init:()=>{
							console.error('Missing ${path}/${this.remoteEntryFilename}.js');
						}
					}
					resolve(proxy);
				};
				script.onload = ()=>{
					const proxy = {
						get:(request)=>window.${cleanName}.get(request),
						init:(arg)=>{
							try{
								return window.${cleanName}.init(arg);
							} catch(e){
								console.log('remote container already initialized')
							}
						}
					}
					resolve(proxy)
				}
				document.head.appendChild(script)
			})`,
      };
    }, {});
  }

  get shared() {
    const { peerDependencies } = this.packageJson ?? {};
    const eager = this.isContainer || false;

    const singletons = [
      "react",
      "react-dom",
      "react-router-dom",
      "react-intl",
      ...(this.options.includeSingletons ?? []),
    ].filter(
      (singleton) => !this.options.excludeSingletons?.includes(singleton)
    );

    return {
      ...peerDependencies,
      ...singletons.reduce(
        (prev, lib) => ({
          ...prev,
          [lib]: {
            singleton: true,
            eager,
            requiredVersion: peerDependencies?.[lib]?.split(".").at(0) ?? "*",
          },
        }),
        {}
      ),
    };
  }

  get moduleFederationConfig(): ModuleFederationConfig {
    if (this.isContainer) {
      return {
        name: this.safeName,
        remotes: this.remoteEntries,
        shared: this.shared,
        ...(this.options.moduleFederationConfig ?? {}),
      };
    }
    return {
      name: this.safeName,
      filename: `${this.remoteEntryFilename}.js`,
      exposes: {
        "./App": "./src/bootstrap",
      },
      shared: this.shared,
      ...(this.options.moduleFederationConfig ?? {}),
    };
  }

  apply(compiler: Compiler) {
    compiler.hooks.emit.tap(this.name, (compilation) => {
      this.setPackageJson(compilation);

      compilation.options.output = {
        ...(compilation.options.output ?? {}),
        ...this.output,
      };

      compilation.options.plugins?.push(
        new ModuleFederationPlugin(this.moduleFederationConfig)
      );
    });
  }
}

const cleanText = (text: string) => text.replace(/[^a-zA-Z0-9]+/g, "_");
