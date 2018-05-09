// @flow
/* eslint-env node */
module.exports = `query SimpleQuery($branch: [String!]) {
  organization(slug: "uberopensource") {
    pipelines(first: 1, search: "fusion-release-verification") {
      edges {
        node {
          builds(branch: $branch, state: [PASSED, FAILED], first: 1) {
            edges {
              node {
                commit
                message
                state
                metaData {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;
