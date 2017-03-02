let Debug = require('debug');
let sinon = require('sinon');
let _ = require('lodash');
let assert = require('assert');

class FakeGithub {
  constructor(installation_id) {
    this.installedOn = null;
    this.taskcluster_yml_files = {};
    this.org_membership = {};
    this.repo_collaborators = {};
    this.github_users = [];
    this.repo_info = {};
    this.repositories = {};

    const throwError = code => {
      let err = new Error();
      err.code = code;
      throw err;
    };

    const stubs = {
      'repos.createStatus': () => {},
      'repos.createCommitComment': () => {},
      'orgs.checkMembership': async ({org, owner}) => {
        if (this.org_membership[org] && this.org_membership[org].has(owner)) {
          return {};
        } else {
          throwError(404);
        }
      },
      'repos.checkCollaborator': async ({owner, repo, collabuser}) => {
        const key = `${owner}/${repo}`;
        if (this.repo_collaborators[key] && this.repo_collaborators[key].has(collabuser)) {
          return {};
        } else {
          throwError(404);
        }
      },
      'repos.get': async ({owner, repo}) => {
        const key = `${owner}/${repo}`;
        if (this.repo_info[key]) {
          return this.repo_info[key];
        } else {
          throwError(404);
        }
      },
      'repos.getContent': async ({owner, repo, path, ref}) => {
        assert.equal(path, '.taskcluster.yml');
        const key = `${owner}/${repo}@${ref}`;
        if (this.taskcluster_yml_files[key]) {
          return {content: new Buffer(
              JSON.stringify(this.taskcluster_yml_files[key])
            ).toString('base64')};
        } else {
          let err = new Error();
          err.code = 404;
          throw err;
        }
      },
      'users.getById': async ({id}) => {
        let user = _.find(this.github_users, {id});
        if (user) {
          return user;
        } else {
          throwError(404);
        }
      },
      'integrations.getInstallationRepositories': async() => {
        return this.repositories;
      },
      'users.getForUser': async ({username}) => {
        let user = _.find(this.github_users, {username});
        if (user) {
          user.id = parseInt(user.id, 10);
          return user;
        } else {
          throwError(404);
        }
      },
    };

    const debug = Debug('FakeGithub');
    _.forEach(stubs, (implementation, name) => {
      let atoms = name.split(/\./);
      let obj = this; // eslint-disable-line consistent-this
      while (atoms.length > 1) {
        const atom = atoms.shift();
        if (!obj[atom]) {
          obj[atom] = {};
        }
        obj = obj[atom];
      }

      const atom = atoms.shift();
      obj[atom] = sinon.spy(async (options) => {
        debug(`inst(${installation_id}).${name}(${JSON.stringify(options)})`);
        return await (implementation || (() => {}))(options);
      });
    });
  }

  setTaskclusterYml({owner, repo, ref, content}) {
    const key = `${owner}/${repo}@${ref}`;
    this.taskcluster_yml_files[key] = content;
  }

  setOrgMember({org, member}) {
    if (!this.org_membership[org]) {
      this.org_membership[org] = new Set();
    }
    this.org_membership[org].add(member);
  }

  setRepoCollaborator({owner, repo, collabuser}) {
    const key = `${owner}/${repo}`;
    if (!this.repo_collaborators[key]) {
      this.repo_collaborators[key] = new Set();
    }
    this.repo_collaborators[key].add(collabuser);
  }

  setRepoInfo({owner, repo, info}) {
    const key = `${owner}/${repo}`;
    this.repo_info[key] = info;
  }

  setUser({id, email, username}) {
    // Please note that here userId is a string. If you need to set up a github API function
    // to get and use userId, you need to use parseInt(id, 10)
    // (as an example, see users.getForUser above)
    this.github_users.push({id: id.toString(), email, username});
  }

  setRepositories(...repoNames) {
    this.repositories.repositories = [...repoNames].map(repo => {return {name: repo};});
  }
}

class FakeGithubAuth {
  constructor() {
    this.installations = {};
  }

  resetStubs() {
    this.installations = {};
  }

  async getInstallationGithub(installation_id) {
    return this.inst(installation_id);
  }

  // sync shorthand to getInstallationGithub for use in test scripts
  inst(installation_id) {
    if (!(installation_id in this.installations)) {
      this.installations[installation_id] = new FakeGithub(installation_id);
    }
    return this.installations[installation_id];
  }

  // For testing purposes, insert a new install
  createInstall(installation_id, owner, repos) {
    let installation = new FakeGithub(installation_id);
    installation.installedOn = owner;
    installation.setRepositories(...repos);
    this.installations[installation_id] = installation;
  }

  async getIntegrationGithub() {
    return {
      integrations: {
        getInstallations: async () => {
          return _.map(this.installations, (install, id) => ({
            id: parseInt(id, 10),
            account: {login: install.installedOn},
          }));
        },
      },
    };
  }
}

module.exports = () => new FakeGithubAuth();
