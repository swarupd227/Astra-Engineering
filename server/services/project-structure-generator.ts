import type { GeneratedFile } from "./dev-agent";

export interface ProjectTemplate {
  name: string;
  techStack: string[];
  files: GeneratedFile[];
}

export class ProjectStructureGenerator {
  generateProjectStructure(techStack: string): GeneratedFile[] {
    const isReact = techStack.toLowerCase().includes('react');
    const isNode = techStack.toLowerCase().includes('node');
    const isExpress = techStack.toLowerCase().includes('express');
    const isMongoDB = techStack.toLowerCase().includes('mongo');
    const isTypeScript = techStack.toLowerCase().includes('typescript') || isReact;

    const files: GeneratedFile[] = [];

    // Package.json - Essential for all Node.js projects
    if (isNode || isReact) {
      files.push(this.generatePackageJson(isReact, isExpress, isMongoDB, isTypeScript));
    }

    // TypeScript configuration
    if (isTypeScript) {
      files.push(this.generateTsConfig(isReact));
    }

    // Environment configuration
    files.push(this.generateEnvExample(isMongoDB, isExpress));

    // README.md
    files.push(this.generateReadme(techStack, isReact, isNode));

    // Git ignore
    files.push(this.generateGitIgnore());

    // Main application files
    if (isReact) {
      files.push(...this.generateReactStructure(isTypeScript));
    }

    if (isNode && isExpress) {
      files.push(...this.generateNodeExpressStructure(isTypeScript, isMongoDB));
    }

    // Docker configuration (optional but useful for deployment)
    files.push(this.generateDockerfile(isReact, isNode));

    return files;
  }

  private generatePackageJson(isReact: boolean, isExpress: boolean, isMongoDB: boolean, isTypeScript: boolean): GeneratedFile {
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};
    const scripts: Record<string, string> = {};

    if (isReact) {
      dependencies["react"] = "^18.2.0";
      dependencies["react-dom"] = "^18.2.0";
      devDependencies["@types/react"] = "^18.2.0";
      devDependencies["@types/react-dom"] = "^18.2.0";
      devDependencies["vite"] = "^5.0.0";
      devDependencies["@vitejs/plugin-react"] = "^4.0.0";
      scripts["dev"] = "vite";
      scripts["build"] = "vite build";
      scripts["preview"] = "vite preview";
    }

    if (isExpress) {
      dependencies["express"] = "^4.18.0";
      dependencies["cors"] = "^2.8.5";
      dependencies["helmet"] = "^7.0.0";
      devDependencies["@types/express"] = "^4.17.0";
      devDependencies["@types/cors"] = "^2.8.0";
      scripts["start"] = "node dist/server.js";
      scripts["dev"] = isTypeScript ? "tsx watch server/index.ts" : "nodemon server/index.js";
    }

    if (isMongoDB) {
      dependencies["mongoose"] = "^8.0.0";
      devDependencies["@types/mongoose"] = "^5.11.0";
    }

    if (isTypeScript) {
      devDependencies["typescript"] = "^5.0.0";
      devDependencies["tsx"] = "^4.0.0";
      scripts["build"] = isReact ? "vite build" : "tsc";
      scripts["type-check"] = "tsc --noEmit";
    }

    // Common dev dependencies
    devDependencies["nodemon"] = "^3.0.0";
    scripts["test"] = "echo \"Error: no test specified\" && exit 1";

    const packageJson = {
      name: "generated-app",
      version: "1.0.0",
      description: "Generated application with complete project structure",
      main: isReact ? "index.html" : (isTypeScript ? "dist/server.js" : "server/index.js"),
      scripts,
      dependencies,
      devDependencies,
      keywords: ["generated", "starter", "boilerplate"],
      author: "Code Generator",
      license: "MIT"
    };

    return {
      path: "package.json",
      content: JSON.stringify(packageJson, null, 2)
    };
  }

  private generateTsConfig(isReact: boolean): GeneratedFile {
    const tsConfig = {
      compilerOptions: {
        target: "ES2020",
        lib: isReact ? ["ES2020", "DOM", "DOM.Iterable"] : ["ES2020"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: isReact,
        jsx: isReact ? "react-jsx" : undefined,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        outDir: "./dist",
        rootDir: "./",
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true
      },
      include: isReact ? ["src/**/*"] : ["server/**/*", "shared/**/*"],
      exclude: ["node_modules", "dist"]
    };

    return {
      path: "tsconfig.json",
      content: JSON.stringify(tsConfig, null, 2)
    };
  }

  private generateEnvExample(isMongoDB: boolean, isExpress: boolean): GeneratedFile {
    let content = `# Environment Configuration
NODE_ENV=development
`;

    if (isExpress) {
      content += `PORT=3000
`;
    }

    if (isMongoDB) {
      content += `
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/generated-app
DB_NAME=generated-app
`;
    }

    content += `
# Security
JWT_SECRET=your-super-secret-jwt-key
SESSION_SECRET=your-session-secret

# CORS
CORS_ORIGIN=http://localhost:3000
`;

    return {
      path: ".env.example",
      content
    };
  }

  private generateReadme(techStack: string, isReact: boolean, isNode: boolean): GeneratedFile {
    let content = `# Generated Application

This application was generated using the Code Generator with the following tech stack: **${techStack}**

## Features

- Complete project structure
- Modern development setup
- TypeScript support
- Environment configuration
- Docker support

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
`;

    if (techStack.toLowerCase().includes('mongo')) {
      content += `- MongoDB (local or cloud instance)
`;
    }

    content += `
### Installation

1. Clone the repository
\`\`\`bash
git clone <repository-url>
cd <repository-name>
\`\`\`

2. Install dependencies
\`\`\`bash
npm install
\`\`\`

3. Set up environment variables
\`\`\`bash
cp .env.example .env
# Edit .env file with your configuration
\`\`\`

### Development

`;

    if (isReact && isNode) {
      content += `Start the development servers:

Backend:
\`\`\`bash
npm run dev:server
\`\`\`

Frontend:
\`\`\`bash
npm run dev:client
\`\`\`
`;
    } else if (isReact) {
      content += `Start the React development server:
\`\`\`bash
npm run dev
\`\`\`
`;
    } else if (isNode) {
      content += `Start the Node.js development server:
\`\`\`bash
npm run dev
\`\`\`
`;
    }

    content += `
### Production Build

\`\`\`bash
npm run build
npm start
\`\`\`

### Docker Support

Build and run using Docker:
\`\`\`bash
docker build -t generated-app .
docker run -p 3000:3000 generated-app
\`\`\`

## Project Structure

\`\`\`
.
├── src/                 # Source code
├── server/              # Backend code (if applicable)
├── dist/                # Built files
├── .env.example         # Environment template
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── Dockerfile           # Docker configuration
└── README.md           # This file
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License
`;

    return {
      path: "README.md",
      content
    };
  }

  private generateGitIgnore(): GeneratedFile {
    const content = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Build outputs
dist/
build/
.next/
out/

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Logs
logs
*.log

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.test

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/

# Database
*.sqlite
*.sqlite3
*.db
`;

    return {
      path: ".gitignore",
      content
    };
  }

  private generateReactStructure(isTypeScript: boolean): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const ext = isTypeScript ? 'tsx' : 'jsx';
    const tsExt = isTypeScript ? 'ts' : 'js';

    // Main App component
    files.push({
      path: `src/App.${ext}`,
      content: `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Generated React Application</h1>
        <p>
          Welcome to your generated application! 
        </p>
        <p>
          Edit <code>src/App.${ext}</code> and save to reload.
        </p>
      </header>
    </div>
  );
}

export default App;
`
    });

    // Main entry point
    files.push({
      path: `src/main.${ext}`,
      content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.${ext}'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')${isTypeScript ? '!' : ''}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`
    });

    // HTML template
    files.push({
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${ext}"></script>
  </body>
</html>
`
    });

    // CSS files
    files.push({
      path: "src/App.css",
      content: `#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.App {
  text-align: center;
}

.App-header {
  background-color: #282c34;
  padding: 20px;
  color: white;
  border-radius: 8px;
  margin-bottom: 20px;
}

.App-header h1 {
  margin: 0 0 16px 0;
}

.App-header p {
  font-size: 16px;
  margin: 8px 0;
}

code {
  background-color: #f1f1f1;
  padding: 2px 4px;
  border-radius: 3px;
  color: #d73a49;
}
`
    });

    files.push({
      path: "src/index.css",
      content: `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
    });

    // Vite config
    files.push({
      path: `vite.config.${tsExt}`,
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
`
    });

    return files;
  }

  private generateNodeExpressStructure(isTypeScript: boolean, isMongoDB: boolean): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const ext = isTypeScript ? 'ts' : 'js';

    // Main server file
    files.push({
      path: `server/index.${ext}`,
      content: `import express${isTypeScript ? ', { Request, Response }' : ''} from 'express';
import cors from 'cors';
import helmet from 'helmet';
${isMongoDB ? "import mongoose from 'mongoose';" : ''}
${isMongoDB ? "import { connectDatabase } from './database';" : ''}
import apiRoutes from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req${isTypeScript ? ': Request' : ''}, res${isTypeScript ? ': Response' : ''}) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Generated API Server'
  });
});

// Error handling middleware
app.use((err${isTypeScript ? ': any' : ''}, req${isTypeScript ? ': Request' : ''}, res${isTypeScript ? ': Response' : ''}, next${isTypeScript ? ': any' : ''}) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

async function startServer() {
  try {
    ${isMongoDB ? 'await connectDatabase();' : '// Database connection would go here'}
    
    app.listen(PORT, () => {
      console.log(\`🚀 Server running on port \${PORT}\`);
      console.log(\`📱 Health check: http://localhost:\${PORT}/health\`);
      console.log(\`📊 API endpoint: http://localhost:\${PORT}/api\`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
`
    });

    // Database connection (if MongoDB)
    if (isMongoDB) {
      files.push({
        path: `server/database.${ext}`,
        content: `import mongoose from 'mongoose';

export async function connectDatabase()${isTypeScript ? ': Promise<void>' : ''} {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/generated-app';
    
    await mongoose.connect(mongoUri);
    
    console.log('✅ Connected to MongoDB');
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('📤 MongoDB disconnected');
    });
    
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('📤 MongoDB connection closed through app termination');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    throw error;
  }
}
`
      });
    }

    // Basic routes
    files.push({
      path: `server/routes.${ext}`,
      content: `import express${isTypeScript ? ', { Request, Response }' : ''} from 'express';

const router = express.Router();

// Sample API route
router.get('/', (req${isTypeScript ? ': Request' : ''}, res${isTypeScript ? ': Response' : ''}) => {
  res.json({ 
    message: 'Welcome to the Generated API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api'
    }
  });
});

// Sample data endpoint
router.get('/data', (req${isTypeScript ? ': Request' : ''}, res${isTypeScript ? ': Response' : ''}) => {
  res.json({
    data: [
      { id: 1, name: 'Sample Item 1', type: 'demo' },
      { id: 2, name: 'Sample Item 2', type: 'demo' }
    ],
    timestamp: new Date().toISOString()
  });
});

export default router;
`
    });

    return files;
  }

  private generateDockerfile(isReact: boolean, isNode: boolean): GeneratedFile {
    let content = `# Multi-stage build for ${isReact ? 'React' : 'Node.js'} application
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

`;

    if (isReact && isNode) {
      content += `# Build stage for React frontend
FROM base AS build-frontend
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.* ./
COPY tsconfig*.json ./
RUN npm run build

# Production stage
FROM base AS production
COPY --from=build-frontend /app/dist ./dist/
COPY server/ ./server/
`;
    } else if (isReact) {
      content += `# Build stage
FROM base AS build
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
`;
    } else if (isNode) {
      content += `# Build stage (if using TypeScript)
FROM base AS build
COPY . .
RUN npm run build || echo "No build script found"

# Production stage
FROM base AS production
COPY --from=build /app/dist ./dist/ 2>/dev/null || COPY server/ ./server/
`;
    }

    content += `
# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
`;

    return {
      path: "Dockerfile",
      content
    };
  }
}