// Simple Vite plugin to handle .olova files
import path from "path";
import { createHash } from "crypto";
import fs from "fs";

export default function olovaPlugin() {
  // Store all CSS content to be combined later
  const allCssContent = new Map();
  // Track if we're in production build
  let isProd = process.env.NODE_ENV === "production";

  return {
    name: "vite-plugin-olova",

    configResolved(config) {
      // Determine if we're in production mode
      isProd = config.isProduction || config.mode === "production";
    },

    // Add this hook to handle CSS extraction
    buildStart() {
      // Clear any previous CSS content
      allCssContent.clear();
    },

    // Add this hook to emit combined CSS file during build
    generateBundle() {
      // Combine all CSS content into a single file
      if (allCssContent.size > 0) {
        let combinedCss = "";

        // Add each component's CSS to the combined file
        for (const [componentName, css] of allCssContent.entries()) {
          combinedCss += `/* ${componentName} Component Styles */\n\n${css}\n\n\n\n`;
        }

        // Emit the combined CSS file
        this.emitFile({
          type: "asset",
          fileName: "assets/style.css",
          source: combinedCss,
        });
      }
    },

    transform(code, id) {
      // Only process .olova files
      if (!id.endsWith(".olova")) return null;

      // Extract component name from file path
      const fileName = path.basename(id, ".olova");
      const componentName =
        fileName.charAt(0).toUpperCase() + fileName.slice(1);

      // Generate a unique hash for this component (for scoped CSS)
      // Use a simple hash function instead of crypto
      const hash = simpleHash(id).substring(0, 8);
      const scopeId = `data-v-${hash}`;

      // Extract script, style, and HTML parts
      const scriptMatch = /<script>([\s\S]*?)<\/script>/;
      const styleMatch = /<style(\s+scoped)?>([\s\S]*?)<\/style>/;
      const scriptContent = (code.match(scriptMatch) || [])[1] || "";

      // Check if style has scoped attribute
      const styleTagMatch = code.match(styleMatch) || [];
      const isScoped = styleTagMatch[1] !== undefined;
      const styleContent = styleTagMatch[2] || "";

      // Get HTML content (everything outside script and style tags)
      let htmlContent = code
        .replace(/<script>[\s\S]*?<\/script>/, "")
        .replace(/<style(\s+scoped)?>([\s\S]*?)<\/style>/, "")
        .trim();

      // Look for import statements in the script
      const importRegex = /import\s+(\w+)\s+from\s+['"](.+?)\.olova['"]/g;
      let importMatch;
      const imports = [];

      while ((importMatch = importRegex.exec(scriptContent)) !== null) {
        imports.push({
          name: importMatch[1],
          path: importMatch[2] + ".olova",
        });
      }

      // Process HTML to replace component tags with component placeholders
      imports.forEach((imp) => {
        const componentTagRegex = new RegExp(
          `<${imp.name}(\\s+[^>]*)?>(.*?)<\\/${imp.name}>|<${imp.name}(\\s+[^>]*)?\\/>`,
          "g"
        );
        htmlContent = htmlContent.replace(
          componentTagRegex,
          (match, attrs1, content, attrs2) => {
            const attrs = attrs1 || attrs2 || "";
            return `<div data-component="${imp.name}" ${attrs}>${
              content || ""
            }</div>`;
          }
        );
      });

      // Process CSS if scoped
      let processedStyle = styleContent;
      if (isScoped) {
        // Transform CSS selectors to include the scope-id
        processedStyle = transformScopedCss(styleContent, scopeId);
      }

      // Store CSS for combined file if there's any style content
      if (styleContent) {
        allCssContent.set(componentName, processedStyle);
      }

      // CSS code for development only
      let cssCode = "";
      if (styleContent && !isProd) {
        cssCode = `
          // Add styles to document head (only once per component type)
          if (!document.querySelector('style[data-olova-component="${componentName}"]')) {
            const styleEl = document.createElement('style');
            styleEl.setAttribute('data-olova-component', '${componentName}');
            styleEl.textContent = \`${processedStyle}\`;
            document.head.appendChild(styleEl);
          }
        `;
      }

      // Modify script content to remove ALL setProps-related code
      const modifiedScriptContent = scriptContent
        .replace(/import\s+(\w+)\s+from\s+['"](.+?)\.olova['"]/g, "")
        // Remove any import of setProps
        .replace(
          /import\s+{?\s*setProps\s*}?\s*from\s+['"][^'"]+['"]\s*;?\s*/g,
          ""
        )
        // Remove variable declarations using setProps
        .replace(/(?:let|const|var)\s+props\s*=\s*setProps\([^)]*\);?/g, "")
        // Remove direct setProps function calls
        .replace(/setProps\([^)]*\);?/g, "")
        // Remove any variable assignments using setProps
        .replace(/\w+\s*=\s*setProps\([^)]*\);?/g, "")
        // Remove function declarations of setProps
        .replace(/function\s+setProps\s*\([^)]*\)\s*{[^}]*}/g, "");

      // Don't process the template here, just escape any backticks
      const escapedHtmlContent = htmlContent.replace(/`/g, "\\`");

      // Generate a component function that renders vanilla HTML/CSS/JS
      let resultCode = `
        // Import directly from main.js instead of olova.js
        
        ${imports
          .map((imp) => `import ${imp.name} from './${imp.path}';`)
          .join("\n")}
        
        // Create the component definition
        function ${componentName}Component() {
          ${cssCode}
          
          // Return a function that will mount the component and run its script
          return function(targetElement) {
            // Create a new container for each component instance
            const container = document.createElement('div');
            container.setAttribute('data-olova-component', '${componentName}');
            ${isScoped ? `container.setAttribute('${scopeId}', '');` : ""}
            
            // Create local references to elements within this component instance
            const querySelector = selector => container.querySelector(selector);
            const querySelectorAll = selector => container.querySelectorAll(selector);
            const getElementById = id => {
              const el = container.querySelector('#' + id);
              return el || document.getElementById(id);
            };
            
            // First add the HTML content to the container
            container.innerHTML = \`${escapedHtmlContent}\`;
            
            // Then run the component script
            ${modifiedScriptContent}
            
            // If scoped, ensure all top-level elements have the scope ID
            ${
              isScoped
                ? `
            Array.from(container.children).forEach(child => {
              if (!child.hasAttribute('${scopeId}')) {
                child.setAttribute('${scopeId}', '');
              }
            });
            `
                : ""
            }
            
            // Append the component's HTML to the target
            targetElement.appendChild(container);
            
            // Mount child components
            ${imports
              .map(
                (imp) => `
              const ${imp.name.toLowerCase()}Elements = container.querySelectorAll('[data-component="${
                  imp.name
                }"]');
              ${imp.name.toLowerCase()}Elements.forEach(el => {
                ${imp.name}(el);
              });
            `
              )
              .join("\n")}
            
            // Return a cleanup function
            return function() {
              if (targetElement.contains(container)) {
                targetElement.removeChild(container);
              }
            };
          };
        }
        
        // Export the component directly without using registerComponent
        export default ${componentName}Component();
      `;

      return {
        code: resultCode,
        map: null, // provide source map if available
      };
    },

    // Add this hook to inject the CSS link in the HTML
    transformIndexHtml(html) {
      // Only add the CSS link if we have CSS content and we're in production
      if (allCssContent.size > 0 && isProd) {
        return html.replace(
          "</head>",
          '  <link rel="stylesheet" href="/assets/style.css">\n</head>'
        );
      }
      return html;
    },
  };
}

// Simple hash function that doesn't rely on Node.js crypto
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex string and ensure it's positive
  return Math.abs(hash).toString(16);
}

// Helper function to transform CSS for scoping
function transformScopedCss(css, scopeId) {
  // Handle nested rules and more complex CSS
  let processedCss = "";
  let inRule = false;
  let currentRule = "";
  let currentSelectors = [];

  // Split by lines for easier processing
  const lines = css.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) {
      processedCss += "\n";
      continue;
    }

    // Check if we're starting a new rule
    if (trimmedLine.includes("{") && !inRule) {
      inRule = true;

      // Extract selectors (everything before the opening brace)
      const selectorPart = trimmedLine
        .substring(0, trimmedLine.indexOf("{"))
        .trim();
      currentSelectors = selectorPart.split(",").map((s) => s.trim());

      // Transform selectors to include scope ID
      const transformedSelectors = currentSelectors.map((selector) => {
        // Skip special at-rules
        if (selector.startsWith("@")) {
          return selector;
        }

        // Handle :root selector
        if (selector.includes(":root")) {
          return selector.replace(":root", `[${scopeId}]`);
        }

        // Add scope ID to normal selectors
        return `[${scopeId}] ${selector}`;
      });

      // Add the transformed rule start to the processed CSS
      processedCss +=
        transformedSelectors.join(", ") +
        " {" +
        trimmedLine.substring(trimmedLine.indexOf("{") + 1) +
        "\n";
    }
    // Check if we're ending a rule
    else if (trimmedLine.includes("}") && inRule) {
      inRule = false;
      currentSelectors = [];
      processedCss += trimmedLine + "\n";
    }
    // We're inside a rule or it's a special at-rule
    else {
      // Handle at-rules (like @media, @keyframes)
      if (trimmedLine.startsWith("@") && trimmedLine.includes("{")) {
        // Just add the at-rule as is
        processedCss += trimmedLine + "\n";
      } else {
        // Regular line inside a rule or standalone
        processedCss += trimmedLine + "\n";
      }
    }
  }

  return processedCss;
}
