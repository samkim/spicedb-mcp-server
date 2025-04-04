# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands
- Build: `npm run build` or `yarn build`
- Start server: `npm start` or `yarn start`
- Dependencies: `npm install` or `yarn install`

## Code Style Guidelines
- **TypeScript**: Strict typing enabled - always use explicit types
- **Imports**: Use ES modules (`import/export`) with `.js` extension in import paths
- **Error Handling**: Use try/catch blocks with error logging to console.error
- **Naming Conventions**:
  - Use camelCase for variables, functions, methods
  - Use PascalCase for classes and interfaces
  - Use snake_case for environment variables
- **Classes**: Use singleton pattern for service clients (see SpiceDBClient)
- **Code Organization**: Group related functionality in self-contained modules
- **Environment Variables**: Use dotenv for configuration
- **Formatting**: Maintain consistent indentation (2 spaces) and semicolons
- **Logging**: Use console.error for server-side logs