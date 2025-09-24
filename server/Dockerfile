# Use Node.js 20 Alpine image for smaller size, targeting AMD64 architecture
FROM --platform=linux/amd64 node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Expose the port
EXPOSE 3001

# Start the application
CMD ["yarn", "start"]
